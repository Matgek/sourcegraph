package nbconvert

/* import (
	"fmt"
	"io/ioutil"
) */

func Render(url string) string {
	/* html, err := ioutil.ReadFile("cmd/frontend/internal/pkg/nbconvert/Part.3.B.4.regex1.html")
	if err != nil{
		fmt.Print(err)
		return ""
	} */
	// nbviewerBaseURL := "https://nbviewer.jupyter.org"
	nbviewerBaseURL := "http://localhost:5000"
	fullURL := nbviewerBaseURL + url
	reHtml := `<iframe src="` + fullURL + `" style="position: absolute; width:100%; height: 100%;border: none;"></iframe>`
	return reHtml
}
