package rcache

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"sourcegraph.com/sourcegraph/sourcegraph/util/fileutil"

	"github.com/mediocregopher/radix.v2/pool"
	"github.com/mediocregopher/radix.v2/redis"
)

const (
	maxClients = 32

	// dataVersion is used for releases that change type struture for
	// data that may already be cached. Increasing this number will
	// change the key prefix that is used for all hash keys,
	// effectively resetting the cache at the same time the new code
	// is deployed.
	dataVersion = "v1"
)

var (
	connPool     *pool.Pool
	globalPrefix string
)

func init() {
	hostname := os.Getenv("SRC_APP_URL")
	if hostname == "" {
		hostname, _ = os.Hostname()
	}
	globalPrefix = fmt.Sprintf("%s:%s", hostname, dataVersion)

	var endpoint string
	if e := os.Getenv("REDIS_MASTER_ENDPOINT"); e != "" {
		endpoint = e
	} else {
		endpoint = createlocalRedisServer()
	}

	var err error
	for i := 0; i < 6; i++ { // try to establish connection 6 times (local Redis server might take awhile to start up)
		var p *pool.Pool
		p, err = pool.New("tcp", endpoint, maxClients)
		if err == nil {
			connPool = p
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
	log.Fatalf("Could not connect to Redis server at %s: %s", endpoint, err)
}

func createlocalRedisServer() string {
	const redisPort = 6379
	const redisImage = "redis"
	redisDir := filepath.Join(fileutil.TempDir(), "redis")

	go func() {
		log.Printf("Attempting to start local Redis")
		cmd := exec.Command("docker", "run", "-p", fmt.Sprintf("%d:%d", redisPort, redisPort), "-v", fmt.Sprintf("%s:/data", redisDir), redisImage)
		cmd.Stdout, cmd.Stderr = nil, nil
		if err := cmd.Start(); err != nil {
			log.Printf("Local Redis probably already running, data dir at %s, listening on %d", redisDir, redisPort)
		} else {
			log.Printf("Local Redis server started, data dir at %s, listening on :%d", redisDir, redisPort)
		}
	}()
	return fmt.Sprintf(":%d", redisPort)
}

// Redis is a cache implemented on top of a Redis client. It is
// designed to mimick the API of cache.Cache to make it easy to switch
// instances of cache.Cache to Redis.
type Redis struct {
	// keyPrefix is the prefix that is prepended to each key stored in
	// Redis by this cache.
	keyPrefix string
}

func New(keyPrefix string) *Redis {
	return &Redis{
		keyPrefix: keyPrefix,
	}
}

var ErrNotFound = errors.New("Redis key not found")

// Get fetches the cached value for the given key into the
// destination. If the key does not exist, it will return ErrNotFound.
func (r *Redis) Get(key string, dst interface{}) error {
	rkey := fmt.Sprintf("%s:%s:%s", globalPrefix, r.keyPrefix, key)

	conn, err := connPool.Get()
	if err != nil {
		return err
	}
	defer connPool.Put(conn)

	resp := conn.Cmd("GET", rkey)
	if resp.IsType(redis.Nil) {
		return ErrNotFound
	}
	if resp.Err != nil {
		return fmt.Errorf("Redis.Get error: %s", resp.Err)
	}

	b, err := resp.Bytes()
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, dst); err != nil {
		return err
	}
	return nil
}

// Add adds a value to the Redis-backed cache with the specified key.
// If ttlSeconds < 0, then a TTL will not be set. Note that setting
// TTL = 0 will return an error.
func (r *Redis) Add(key string, val interface{}, ttlSeconds int) error {
	rkey := fmt.Sprintf("%s:%s:%s", globalPrefix, r.keyPrefix, key)

	conn, err := connPool.Get()
	if err != nil {
		return err
	}
	defer connPool.Put(conn)

	vjson, err := json.Marshal(val)
	if err != nil {
		return err
	}

	if ttlSeconds < 0 {
		resp := conn.Cmd("SET", rkey, vjson)
		if resp.Err != nil {
			return fmt.Errorf("Redis.Add error: %s", resp.Err)
		}
	} else {
		resp := conn.Cmd("SETEX", rkey, ttlSeconds, vjson)
		if resp.Err != nil {
			return fmt.Errorf("Redis.Add error: %s", resp.Err)
		}
	}
	return nil
}
