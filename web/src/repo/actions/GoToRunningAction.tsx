import * as H from 'history'
import * as React from 'react'
import { toRunningURL } from '../../util/url'

/**
 * A repository header action that redirect to a binder instance running the repo in a container.
 */
export class GoToRunningAction extends React.PureComponent<{
    location: H.Location
}> {
    public componentDidMount(): void {
        // Trigger the user presses 'y'.
    }

    public render(): JSX.Element | null {
        const runningLink = toRunningURL()
        return (
            <div>
                <a href={runningLink.binderURL} target="_blank" data-tooltip="Run in Binder(JupyterLab)">
                    <button className="btn run-button btn-secondary">
                        <img className="icon-inline" src="/.assets/img/binder-logo.png" />
                        <span className="d-none d-lg-inline"> Binder </span>
                    </button>
                </a>
                <a href={runningLink.floyldURL} target="_blank" data-tooltip="Run in FloydHub">
                    <button className="btn run-button btn-secondary">
                        <img className="icon-inline" src="/.assets/img/FloyldHub-logo.png" />
                        <span className="d-none d-lg-inline"> FloydHub </span>
                    </button>
                </a>
                <a href={runningLink.colabURL} target="_blank" data-tooltip="Run in Google Colab">
                    <button className="btn run-button btn-secondary">
                        <img className="icon-inline" src="/.assets/img/colab_favicon_256px.png" />
                        <span className="d-none d-lg-inline"> Colab </span>
                    </button>
                </a>
            </div>
        )
    }
}
