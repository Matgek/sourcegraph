import * as H from 'history'
import ArrowRightDropCircleIcon from 'mdi-react/ArrowRightDropCircleIcon'
import * as React from 'react'
import { toBinderURL } from '../../util/url'

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
        return (
            <a href={this.runningURL} target="_blank" data-tooltip="RUN this Repo">
                <button className="btn btn-primary">
                    <ArrowRightDropCircleIcon className="icon-inline" />
                    <span className="d-none d-lg-inline"> Run </span>
                </button>
            </a>
        )
    }

    private get runningURL(): string {
        return toBinderURL(this.props.location.pathname + this.props.location.search + this.props.location.hash)
    }
}
