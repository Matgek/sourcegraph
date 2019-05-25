package nbconvert

import (
	"github.com/sourcegraph/sourcegraph/pkg/env"
)

var nbviewerBaseURL = env.Get("SRC_NBVIEWER_URL", "", "the base url of nbviewer service")

func Render(url string) string {
	/* html, err := ioutil.ReadFile("cmd/frontend/internal/pkg/nbconvert/Part.3.B.4.regex1.html")
	if err != nil{
		fmt.Print(err)
		return ""
	} */
	// nbviewerBaseURL := "https://nbviewer.jupyter.org"
	// nbviewerBaseURL := "http://119.3.32.184:8080"
	fullURL := nbviewerBaseURL + url
	reHtml := `<iframe src="` + fullURL + `"style="width:100%; height:70rem; border: none;"></iframe>`
	return reHtml
}
