import { isEqual, upperFirst } from 'lodash'
import AlertCircleIcon from 'mdi-react/AlertCircleIcon'
import MapSearchIcon from 'mdi-react/MapSearchIcon'
import * as React from 'react'
import { Route, RouteComponentProps, Switch } from 'react-router'
import { defer, Subject, Subscription } from 'rxjs'
import { catchError, delay, distinctUntilChanged, map, retryWhen, switchMap, tap } from 'rxjs/operators'
import { ActivationProps } from '../../../shared/src/components/activation/Activation'
import { ExtensionsControllerProps } from '../../../shared/src/extensions/controller'
import * as GQL from '../../../shared/src/graphql/schema'
import { PlatformContextProps } from '../../../shared/src/platform/context'
import { SettingsCascadeProps } from '../../../shared/src/settings/settings'
import { ErrorLike, isErrorLike } from '../../../shared/src/util/errors'
import { HeroPage } from '../components/HeroPage'
import { PopoverButton } from '../components/PopoverButton'
import { ChromeExtensionToast } from '../marketing/BrowserExtensionToast'
import { SurveyToast } from '../marketing/SurveyToast'
import { IS_CHROME } from '../marketing/util'
import { ThemeProps } from '../theme'
import { RouteDescriptor } from '../util/contributions'
import { CopyLinkAction } from './actions/CopyLinkAction'
import { GoToBinderAction } from './actions/GoToBinderAction'
import { GoToColabAction } from './actions/GoToColabAction'
import { GoToFloydHubAction } from './actions/GoToFloydHubAction'
import { GoToPermalinkAction } from './actions/GoToPermalinkAction'
import { CloneInProgressError, ECLONEINPROGESS, EREPONOTFOUND, EREVNOTFOUND, ResolvedRev, resolveRev } from './backend'
import { RepoHeaderContributionsLifecycleProps } from './RepoHeader'
import { RepoHeaderContributionPortal } from './RepoHeaderContributionPortal'
import { EmptyRepositoryPage, RepositoryCloningInProgressPage } from './RepositoryGitDataContainer'
import { RevisionsPopover } from './RevisionsPopover'
import { GoToRunHelpAction } from './actions/GoToRunHelpAction'

export interface RepoRevContainerContext
    extends RepoHeaderContributionsLifecycleProps,
        SettingsCascadeProps,
        ExtensionsControllerProps,
        PlatformContextProps,
        ThemeProps,
        ActivationProps {
    repo: GQL.IRepository
    rev: string
    authenticatedUser: GQL.IUser | null
    resolvedRev: ResolvedRev
    routePrefix: string
}

export interface RepoRevContainerRoute extends RouteDescriptor<RepoRevContainerContext> {}

interface RepoRevContainerProps
    extends RouteComponentProps<{}>,
        RepoHeaderContributionsLifecycleProps,
        SettingsCascadeProps,
        PlatformContextProps,
        ExtensionsControllerProps,
        ThemeProps,
        ActivationProps {
    routes: ReadonlyArray<RepoRevContainerRoute>
    repo: GQL.IRepository
    rev: string
    authenticatedUser: GQL.IUser | null
    routePrefix: string

    /**
     * The resolved rev or an error if it could not be resolved. This value lives in RepoContainer (this
     * component's parent) but originates from this component.
     */
    resolvedRevOrError?: ResolvedRev | ErrorLike

    /** Called when the resolvedRevOrError state in this component's parent should be updated. */
    onResolvedRevOrError: (v: ResolvedRev | ErrorLike | undefined) => void
}

interface RepoRevContainerState {
    showSidebar: boolean
}

/**
 * A container for a repository page that incorporates revisioned Git data. (For example,
 * blob and tree pages are revisioned, but the repository settings page is not.)
 */
export class RepoRevContainer extends React.PureComponent<RepoRevContainerProps, RepoRevContainerState> {
    public state: RepoRevContainerState = {
        showSidebar: true,
    }

    private propsUpdates = new Subject<RepoRevContainerProps>()
    private subscriptions = new Subscription()

    public componentDidMount(): void {
        const repoRevChanges = this.propsUpdates.pipe(
            // Pick repoName and rev out of the props
            map(props => ({ repoName: props.repo.name, rev: props.rev })),
            distinctUntilChanged((a, b) => isEqual(a, b))
        )

        // Fetch repository revision.
        this.subscriptions.add(
            repoRevChanges
                .pipe(
                    // Reset resolved rev / error state
                    tap(() => this.props.onResolvedRevOrError(undefined)),
                    switchMap(({ repoName, rev }) =>
                        defer(() => resolveRev({ repoName, rev })).pipe(
                            // On a CloneInProgress error, retry after 1s
                            retryWhen(errors =>
                                errors.pipe(
                                    tap(error => {
                                        switch (error.code) {
                                            case ECLONEINPROGESS:
                                                // Display cloning screen to the user and retry
                                                this.props.onResolvedRevOrError(error)
                                                return
                                            default:
                                                // Display error to the user and do not retry
                                                throw error
                                        }
                                    }),
                                    delay(1000)
                                )
                            ),
                            // Save any error in the sate to display to the user
                            catchError(error => {
                                this.props.onResolvedRevOrError(error)
                                return []
                            })
                        )
                    )
                )
                .subscribe(
                    resolvedRev => {
                        this.props.onResolvedRevOrError(resolvedRev)
                    },
                    error => {
                        // Should never be reached because errors are caught above
                        console.error(error)
                    }
                )
        )

        this.propsUpdates.next(this.props)
    }

    public componentWillReceiveProps(props: RepoRevContainerProps): void {
        this.propsUpdates.next(props)
    }

    public componentWillUnmount(): void {
        this.subscriptions.unsubscribe()
    }

    public render(): JSX.Element | null {
        if (!this.props.resolvedRevOrError) {
            // Render nothing while loading
            return null
        }

        if (isErrorLike(this.props.resolvedRevOrError)) {
            // Show error page
            switch (this.props.resolvedRevOrError.code) {
                case ECLONEINPROGESS:
                    return (
                        <RepositoryCloningInProgressPage
                            repoName={this.props.repo.name}
                            progress={(this.props.resolvedRevOrError as CloneInProgressError).progress}
                        />
                    )
                case EREPONOTFOUND:
                    return (
                        <HeroPage
                            icon={MapSearchIcon}
                            title="404: Not Found"
                            subtitle="The requested repository was not found."
                        />
                    )
                case EREVNOTFOUND:
                    if (!this.props.rev) {
                        return <EmptyRepositoryPage />
                    }

                    return (
                        <HeroPage
                            icon={MapSearchIcon}
                            title="404: Not Found"
                            subtitle="The requested revision was not found."
                        />
                    )
                default:
                    return (
                        <HeroPage
                            icon={AlertCircleIcon}
                            title="Error"
                            subtitle={upperFirst(this.props.resolvedRevOrError.message)}
                        />
                    )
            }
        }

        const context: RepoRevContainerContext = {
            platformContext: this.props.platformContext,
            extensionsController: this.props.extensionsController,
            isLightTheme: this.props.isLightTheme,
            activation: this.props.activation,
            repo: this.props.repo,
            repoHeaderContributionsLifecycleProps: this.props.repoHeaderContributionsLifecycleProps,
            resolvedRev: this.props.resolvedRevOrError,
            rev: this.props.rev,
            routePrefix: this.props.routePrefix,
            authenticatedUser: this.props.authenticatedUser,
            settingsCascade: this.props.settingsCascade,
        }

        return (
            <div className="repo-rev-container">
                {IS_CHROME && <ChromeExtensionToast />}
                <SurveyToast authenticatedUser={this.props.authenticatedUser} />
                <RepoHeaderContributionPortal
                    position="nav"
                    priority={100}
                    element={
                        <PopoverButton
                            key="repo-rev"
                            className="repo-header__section-btn repo-header__rev"
                            globalKeyBinding="v"
                            popoverElement={
                                <RevisionsPopover
                                    repo={this.props.repo.id}
                                    repoName={this.props.repo.name}
                                    defaultBranch={this.props.resolvedRevOrError.defaultBranch}
                                    currentRev={this.props.rev}
                                    currentCommitID={this.props.resolvedRevOrError.commitID}
                                    history={this.props.history}
                                    location={this.props.location}
                                />
                            }
                            hideOnChange={`${this.props.repo.id}:${this.props.rev || ''}`}
                        >
                            {(this.props.rev && this.props.rev === this.props.resolvedRevOrError.commitID
                                ? this.props.resolvedRevOrError.commitID.slice(0, 7)
                                : this.props.rev) ||
                                this.props.resolvedRevOrError.defaultBranch ||
                                'HEAD'}
                        </PopoverButton>
                    }
                    repoHeaderContributionsLifecycleProps={this.props.repoHeaderContributionsLifecycleProps}
                />
                <Switch>
                    {this.props.routes.map(
                        ({ path, render, exact, condition = () => true }) =>
                            condition(context) && (
                                <Route
                                    path={this.props.routePrefix + path}
                                    key="hardcoded-key" // see https://github.com/ReactTraining/react-router/issues/4578#issuecomment-334489490
                                    exact={exact}
                                    // tslint:disable-next-line:jsx-no-lambda RouteProps.render is an exception
                                    render={routeComponentProps => render({ ...context, ...routeComponentProps })}
                                />
                            )
                    )}
                </Switch>
                <RepoHeaderContributionPortal
                    position="left"
                    element={<CopyLinkAction key="copy-link" location={this.props.location} />}
                    repoHeaderContributionsLifecycleProps={this.props.repoHeaderContributionsLifecycleProps}
                />
                <RepoHeaderContributionPortal
                    position="right"
                    priority={3}
                    element={
                        <GoToPermalinkAction
                            key="go-to-permalink"
                            rev={this.props.rev}
                            commitID={this.props.resolvedRevOrError.commitID}
                            location={this.props.location}
                            history={this.props.history}
                        />
                    }
                    repoHeaderContributionsLifecycleProps={this.props.repoHeaderContributionsLifecycleProps}
                />
                <RepoHeaderContributionPortal
                    position="right"
                    priority={1}
                    element={<GoToBinderAction key="go-to-binder" location={this.props.location} />}
                    repoHeaderContributionsLifecycleProps={this.props.repoHeaderContributionsLifecycleProps}
                />
                <RepoHeaderContributionPortal
                    position="right"
                    priority={1}
                    element={<GoToFloydHubAction key="go-to-floydhub" location={this.props.location} />}
                    repoHeaderContributionsLifecycleProps={this.props.repoHeaderContributionsLifecycleProps}
                />
                <RepoHeaderContributionPortal
                    position="right"
                    priority={1}
                    element={<GoToColabAction key="go-to-colab" location={this.props.location} />}
                    repoHeaderContributionsLifecycleProps={this.props.repoHeaderContributionsLifecycleProps}
                />
                <RepoHeaderContributionPortal
                    position="right"
                    priority={1}
                    element={<GoToRunHelpAction key="go-to-run-help" location={this.props.location} />}
                    repoHeaderContributionsLifecycleProps={this.props.repoHeaderContributionsLifecycleProps}
                />
            </div>
        )
    }
}
