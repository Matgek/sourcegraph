package graphqlbackend

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"regexp"
	"errors"

	"github.com/sourcegraph/sourcegraph/cmd/frontend/backend"
	"github.com/sourcegraph/sourcegraph/cmd/frontend/graphqlbackend/externallink"
	"github.com/sourcegraph/sourcegraph/cmd/frontend/graphqlbackend/graphqlutil"
	"github.com/sourcegraph/sourcegraph/pkg/api"
	"github.com/sourcegraph/sourcegraph/pkg/vcs/git"

	graphql "github.com/graph-gophers/graphql-go"
	"github.com/graph-gophers/graphql-go/relay"
)

func gitCommitByID(ctx context.Context, id graphql.ID) (*gitCommitResolver, error) {
	repoID, commitID, err := unmarshalGitCommitID(id)
	if err != nil {
		return nil, err
	}
	repo, err := repositoryByID(ctx, repoID)
	if err != nil {
		return nil, err
	}
	return repo.Commit(ctx, &repositoryCommitArgs{Rev: string(commitID)})
}

type gitCommitResolver struct {
	repo *repositoryResolver

	// inputRev is the Git revspec that the user originally requested that resolved to this Git commit. It is used
	// to avoid redirecting a user browsing a revision "mybranch" to the absolute commit ID as they follow links in the UI.
	inputRev *string

	oid     gitObjectID
	once    sync.Once
	onceErr error

	author    signatureResolver
	committer *signatureResolver
	message   string
	parents   []api.CommitID
}

func toGitCommitResolver(repo *repositoryResolver, commit *git.Commit) *gitCommitResolver {
	authorResolver := toSignatureResolver(&commit.Author)
	return &gitCommitResolver{
		repo: repo,

		oid: gitObjectID(commit.ID),

		author:    *authorResolver,
		committer: toSignatureResolver(commit.Committer),
		message:   commit.Message,
		parents:   commit.Parents,
	}
}

// gitCommitGQLID is a type used for marshaling and unmarshaling a Git commit's
// GraphQL ID.
type gitCommitGQLID struct {
	Repository graphql.ID  `json:"r"`
	CommitID   gitObjectID `json:"c"`
}

func marshalGitCommitID(repo graphql.ID, commitID gitObjectID) graphql.ID {
	return relay.MarshalID("GitCommit", gitCommitGQLID{Repository: repo, CommitID: commitID})
}

func unmarshalGitCommitID(id graphql.ID) (repoID graphql.ID, commitID gitObjectID, err error) {
	var spec gitCommitGQLID
	err = relay.UnmarshalSpec(id, &spec)
	return spec.Repository, spec.CommitID, err
}

func (r *gitCommitResolver) ID() graphql.ID {
	oid, _ := r.OID()
	return marshalGitCommitID(r.repo.ID(), oid)
}

func (r *gitCommitResolver) Repository() *repositoryResolver { return r.repo }

func (r *gitCommitResolver) OID() (gitObjectID, error) {
	return r.getCommitOID()
}

func (r *gitCommitResolver) getCommitOID() (gitObjectID, error) {
	r.once.Do(func() {
		// If we already have the commit, no need to try to compute it.
		if r.oid != "" {
			return
		}

		// Commit OID is the empty string denoting the default branch. Find out
		// what is the latest commit indexed by zoekt.

		indexInfo := r.repo.TextSearchIndex()

		ctx := context.Background()

		var refs []*repositoryTextSearchIndexedRef
		refs, r.onceErr = indexInfo.Refs(ctx)
		if r.onceErr != nil {
			return
		}

		for _, ref := range refs {
			current, _ := ref.Current(ctx)
			if current {
				r.oid = ref.indexedCommit

				break
			}
		}
	})

	return r.oid, r.onceErr
}

func (r *gitCommitResolver) AbbreviatedOID() (string, error) {
	commit, err := r.OID()
	if err != nil {
		return "", err
	}
	return string(commit)[:7], err
}
func (r *gitCommitResolver) Author() *signatureResolver    { return &r.author }
func (r *gitCommitResolver) Committer() *signatureResolver { return r.committer }
func (r *gitCommitResolver) Message() string               { return r.message }
func (r *gitCommitResolver) Subject() string               { return gitCommitSubject(r.message) }
func (r *gitCommitResolver) Body() *string {
	body := gitCommitBody(r.message)
	if body == "" {
		return nil
	}
	return &body
}

func (r *gitCommitResolver) Parents(ctx context.Context) ([]*gitCommitResolver, error) {
	resolvers := make([]*gitCommitResolver, len(r.parents))
	for i, parent := range r.parents {
		var err error
		resolvers[i], err = r.repo.Commit(ctx, &repositoryCommitArgs{Rev: string(parent)})
		if err != nil {
			return nil, err
		}
	}
	return resolvers, nil
}

func (r *gitCommitResolver) URL() (string, error) {
	rev, err := r.inputRevOrImmutableRev()
	if err != nil {
		return "", err
	}
	return r.repo.URL() + "/-/commit/" + string(rev), nil
}

func (r *gitCommitResolver) CanonicalURL() (string, error) {
	oid, err := r.OID()
	if err != nil {
		return "", err
	}
	return r.repo.URL() + "/-/commit/" + string(oid), nil
}

func (r *gitCommitResolver) ExternalURLs(ctx context.Context) ([]*externallink.Resolver, error) {
	oid, err := r.OID()
	if err != nil {
		return nil, err
	}
	return externallink.Commit(ctx, r.repo.repo, api.CommitID(oid))
}

func (r *gitCommitResolver) Tree(ctx context.Context, args *struct {
	Path      string
	Recursive bool
}) (*gitTreeEntryResolver, error) {
	cachedRepo, err := backend.CachedGitRepo(ctx, r.repo.repo)
	if err != nil {
		return nil, err
	}
	oid, err := r.OID()
	if err != nil {
		return nil, err
	}
	stat, err := git.Stat(ctx, *cachedRepo, api.CommitID(oid), args.Path)
	if err != nil {
		return nil, err
	}
	if !stat.Mode().IsDir() {
		return nil, fmt.Errorf("not a directory: %q", args.Path)
	}
	return &gitTreeEntryResolver{
		commit:      r,
		path:        args.Path,
		stat:        stat,
		isRecursive: args.Recursive,
	}, nil
}

func (r *gitCommitResolver) Blob(ctx context.Context, args *struct {
	Path string
}) (*gitTreeEntryResolver, error) {
	cachedRepo, err := backend.CachedGitRepo(ctx, r.repo.repo)
	if err != nil {
		return nil, err
	}
	oid, err := r.OID()
	if err != nil {
		return nil, err
	}
	stat, err := git.Stat(ctx, *cachedRepo, api.CommitID(oid), args.Path)
	if err != nil {
		return nil, err
	}
	if !stat.Mode().IsRegular() {
		return nil, fmt.Errorf("not a blob: %q", args.Path)
	}
	return &gitTreeEntryResolver{
		commit: r,
		path:   args.Path,
		stat:   stat,
	}, nil
}

func (r *gitCommitResolver) File(ctx context.Context, args *struct {
	Path string
}) (*gitTreeEntryResolver, error) {
	return r.Blob(ctx, args)
}

func (r *gitCommitResolver) Languages(ctx context.Context) ([]string, error) {
	oid, err := r.OID()
	if err != nil {
		return nil, err
	}
	inventory, err := backend.Repos.GetInventory(ctx, r.repo.repo, api.CommitID(oid))
	if err != nil {
		return nil, err
	}

	names := make([]string, len(inventory.Languages))
	for i, l := range inventory.Languages {
		names[i] = l.Name
	}
	return names, nil
}

func (r *gitCommitResolver) Ancestors(ctx context.Context, args *struct {
	graphqlutil.ConnectionArgs
	Query *string
	Path  *string
}) (*gitCommitConnectionResolver, error) {
	oid, err := r.OID()
	if err != nil {
		return nil, nil
	}
	return &gitCommitConnectionResolver{
		revisionRange: string(oid),
		first:         args.ConnectionArgs.First,
		query:         args.Query,
		path:          args.Path,
		repo:          r.repo,
	}, nil
}

func (r *gitCommitResolver) BehindAhead(ctx context.Context, args *struct {
	Revspec string
}) (*behindAheadCountsResolver, error) {
	cachedRepo, err := backend.CachedGitRepo(ctx, r.repo.repo)
	if err != nil {
		return nil, err
	}
	oid, err := r.OID()
	if err != nil {
		return nil, err
	}
	counts, err := git.GetBehindAhead(ctx, *cachedRepo, args.Revspec, string(oid))
	if err != nil {
		return nil, err
	}
	return &behindAheadCountsResolver{
		behind: int32(counts.Behind),
		ahead:  int32(counts.Ahead),
	}, nil
}

type behindAheadCountsResolver struct{ behind, ahead int32 }

func (r *behindAheadCountsResolver) Behind() int32 { return r.behind }
func (r *behindAheadCountsResolver) Ahead() int32  { return r.ahead }

// inputRevOrImmutableRev returns the input revspec, if it is provided and nonempty. Otherwise it returns the
// canonical OID for the revision.
func (r *gitCommitResolver) inputRevOrImmutableRev() (string, error) {
	if r.inputRev != nil && *r.inputRev != "" {
		return escapeRevspecForURL(*r.inputRev), nil
	}
	oid, err := r.OID()
	return string(oid), err
}

// repoRevURL returns the URL path prefix to use when constructing URLs to resources at this
// revision. Unlike inputRevOrImmutableRev, it does NOT use the OID if no input revspec is
// given. This is because the convention in the frontend is for repo-rev URLs to omit the "@rev"
// portion (unlike for commit page URLs, which must include some revspec in
// "/REPO/-/commit/REVSPEC").
func (r *gitCommitResolver) repoRevURL() (string, error) {
	url := r.repo.URL()
	var rev string
	if r.inputRev != nil {
		rev = *r.inputRev // use the original input rev from the user
	} else {
		oid, err := r.OID()
		if err != nil {
			return "", err
		}
		rev = string(oid)
	}
	if rev != "" {
		return url + "@" + escapeRevspecForURL(rev), nil
	}
	return url, nil
}
// returns the URL for access to the ipynb rendered in nbviewer,
// e.g., "github/githubuser/githubreponame/blob/rev/"
func (r *gitCommitResolver) repoRevNbURL() (string, error) {
	url := r.repo.URL()
	if ok, _ := regexp.MatchString(`(?m)^/github\.com/`, url); !ok {
		return "", errors.New("The Repo's URL does not start with 'github.com'")
	}
	var rev string
	if r.inputRev != nil {
		rev = *r.inputRev // use the original input rev from the user
	} else {
		oid, err := r.OID()
		if err != nil {
			return "", err
		}
		rev = string(oid)
	}
	if rev != "" {
		url = strings.Replace(url, "github.com", "github", 1) + "/blob/" + rev
		return url, nil
	}
	return "", errors.New("the rev is null")
}

func (r *gitCommitResolver) canonicalRepoRevURL() (string, error) {
	oid, err := r.OID()
	if err != nil {
		return "", err
	}
	return r.repo.URL() + "@" + string(oid), nil
}

// gitCommitBody returns the first line of the Git commit message.
func gitCommitSubject(message string) string {
	i := strings.Index(message, "\n")
	if i == -1 {
		return message
	}
	return message[:i]
}

// gitCommitBody returns the contents of the Git commit message after the subject.
func gitCommitBody(message string) string {
	i := strings.Index(message, "\n")
	if i == -1 {
		return ""
	}
	return strings.TrimSpace(message[i:])
}
