import * as H from 'history'
import * as React from 'react'
import { LinkOrButton } from '../../../../shared/src/components/LinkOrButton'
import { toFloydHubURL } from '../../util/url'

/**
 * A repository header action that redirect to a binder instance running the repo in a container.
 */
export class GoToFloydHubAction extends React.PureComponent<{
    location: H.Location
}> {
    public componentDidMount(): void {
        // Trigger the user presses 'y'.
    }

    public render(): JSX.Element | null {
        const floydHubLink = toFloydHubURL()
        return (
            <LinkOrButton to={floydHubLink} target="_blank" data-tooltip={`Run in FloydHub`}>
                <img className="icon-inline" src="/.assets/img/FloyldHub-logo.png" />
                <span className="d-none d-lg-inline"> FloydHub </span>
            </LinkOrButton>
        )
    }
}
