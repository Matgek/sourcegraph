import * as H from 'history'
import * as React from 'react'
import { LinkOrButton } from '../../../../shared/src/components/LinkOrButton'
import { toBinderURL } from '../../util/url'

/**
 * A repository header action that redirect to a binder instance running the repo in a container.
 */
export class GoToBinderAction extends React.PureComponent<{
    location: H.Location
}> {
    public componentDidMount(): void {
        // Trigger the user presses 'y'.
    }

    public render(): JSX.Element | null {
        const binderLink = toBinderURL()
        return (
            <LinkOrButton to={binderLink} target="_blank" data-tooltip={`Run in Binder(JupyterLab)`}>
                <img className="icon-inline" src="/.assets/img/binder-logo.png" />
                <span className="d-none d-lg-inline"> Binder </span>
            </LinkOrButton>
        )
    }
}
