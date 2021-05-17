import * as H from 'history'
import * as React from 'react'
import { LinkOrButton } from '../../../../shared/src/components/LinkOrButton'
import { toColabURL } from '../../util/url'

/**
 * A repository header action that redirect to a binder instance running the repo in a container.
 */
export class GoToColabAction extends React.PureComponent<{
    location: H.Location
}> {
    public componentDidMount(): void {
        // Trigger the user presses 'y'.
    }

    public render(): JSX.Element | null {
        const colabLink = toColabURL()
        return (
            <LinkOrButton to={colabLink} target="_blank" data-tooltip={`Run in Google Colab`}>
                <img className="icon-inline" src="/.assets/img/colab_favicon_256px.png" />
                <span className="d-none d-lg-inline"> Colab </span>
            </LinkOrButton>
        )
    }
}
