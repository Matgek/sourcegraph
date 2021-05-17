import * as H from 'history'
import HelpCircleOutlineIcon from 'mdi-react/HelpCircleOutlineIcon'
import * as React from 'react'
import { LinkOrButton } from '../../../../shared/src/components/LinkOrButton'

/**
 * A repository header action that redirect to a binder instance running the repo in a container.
 */
export class GoToRunHelpAction extends React.PureComponent<{
    location: H.Location
}> {
    public componentDidMount(): void {
        // Trigger the user presses 'y'.
    }

    public render(): JSX.Element | null {
        const helpLink = `https://github.com/nbshare/nbshare-doc/blob/master/running-help.md`
        return (
            <LinkOrButton to={helpLink} target="_blank" data-tooltip={`Help on how to run the repo`}>
                <HelpCircleOutlineIcon className="icon-inline small" />
            </LinkOrButton>
        )
    }
}
