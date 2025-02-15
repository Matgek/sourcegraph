import * as H from 'history'
import { isEqual, pick, upperFirst } from 'lodash'
import AlertCircleIcon from 'mdi-react/AlertCircleIcon'
import * as React from 'react'
import { combineLatest, Observable, Subject, Subscription } from 'rxjs'
import { catchError, distinctUntilChanged, map, mapTo, startWith, switchMap, tap } from 'rxjs/operators'
import { ExtensionsControllerProps } from '../../../../shared/src/extensions/controller'
import { gql } from '../../../../shared/src/graphql/graphql'
import * as GQL from '../../../../shared/src/graphql/schema'
import { PlatformContextProps } from '../../../../shared/src/platform/context'
import { SettingsCascadeProps } from '../../../../shared/src/settings/settings'
import { createAggregateError, ErrorLike, isErrorLike } from '../../../../shared/src/util/errors'
import { memoizeObservable } from '../../../../shared/src/util/memoizeObservable'
import {
    AbsoluteRepoFile,
    lprToRange,
    makeRepoURI,
    ModeSpec,
    ParsedRepoURI,
    parseHash,
} from '../../../../shared/src/util/url'
import { queryGraphQL } from '../../backend/graphql'
import { HeroPage } from '../../components/HeroPage'
import { PageTitle } from '../../components/PageTitle'
import { isDiscussionsEnabled } from '../../discussions'
import { ThemeProps } from '../../theme'
import { eventLogger } from '../../tracking/eventLogger'
import { RepoHeaderContributionsLifecycleProps } from '../RepoHeader'
import { RepoHeaderContributionPortal } from '../RepoHeaderContributionPortal'
import { ToggleDiscussionsPanel } from './actions/ToggleDiscussions'
import { ToggleHistoryPanel } from './actions/ToggleHistoryPanel'
import { ToggleLineWrap } from './actions/ToggleLineWrap'
import { ToggleRenderedFileMode } from './actions/ToggleRenderedFileMode'
import { Blob } from './Blob'
import { BlobPanel } from './panel/BlobPanel'
import { RenderedFile } from './RenderedFile'

export function fetchBlobCacheKey(parsed: ParsedRepoURI & { isLightTheme: boolean; disableTimeout: boolean }): string {
    return makeRepoURI(parsed) + parsed.isLightTheme + parsed.disableTimeout
}

export const fetchBlob = memoizeObservable(
    (args: {
        repoName: string
        commitID: string
        filePath: string
        isLightTheme: boolean
        disableTimeout: boolean
    }): Observable<GQL.IGitBlob> =>
        queryGraphQL(
            gql`
                query Blob(
                    $repoName: String!
                    $commitID: String!
                    $filePath: String!
                    $isLightTheme: Boolean!
                    $disableTimeout: Boolean!
                ) {
                    repository(name: $repoName) {
                        commit(rev: $commitID) {
                            file(path: $filePath) {
                                content
                                richHTML
                                highlight(disableTimeout: $disableTimeout, isLightTheme: $isLightTheme) {
                                    aborted
                                    html
                                }
                            }
                        }
                    }
                }
            `,
            args
        ).pipe(
            map(({ data, errors }) => {
                if (
                    !data ||
                    !data.repository ||
                    !data.repository.commit ||
                    !data.repository.commit.file ||
                    !data.repository.commit.file.highlight
                ) {
                    throw createAggregateError(errors)
                }
                return data.repository.commit.file
            })
        ),
    fetchBlobCacheKey
)

interface Props
    extends AbsoluteRepoFile,
        ModeSpec,
        RepoHeaderContributionsLifecycleProps,
        SettingsCascadeProps,
        PlatformContextProps,
        ExtensionsControllerProps,
        ThemeProps {
    location: H.Location
    history: H.History
    repoID: GQL.ID
    authenticatedUser: GQL.IUser | null
}

interface State {
    wrapCode: boolean

    /**
     * The blob data or error that happened.
     * undefined while loading.
     */
    blobOrError?: GQL.IGitBlob | ErrorLike
}

export class BlobPage extends React.PureComponent<Props, State> {
    private propsUpdates = new Subject<Props>()
    private extendHighlightingTimeoutClicks = new Subject<void>()
    private subscriptions = new Subscription()

    constructor(props: Props) {
        super(props)

        this.state = {
            wrapCode: ToggleLineWrap.getValue(),
        }
    }

    private logViewEvent(): void {
        eventLogger.logViewEvent('Blob', { fileShown: true })
    }

    public componentDidMount(): void {
        this.logViewEvent()

        // Fetch repository revision.
        this.subscriptions.add(
            combineLatest(
                this.propsUpdates.pipe(
                    map(props => pick(props, 'repoName', 'commitID', 'filePath', 'isLightTheme')),
                    distinctUntilChanged((a, b) => isEqual(a, b))
                ),
                this.extendHighlightingTimeoutClicks.pipe(
                    mapTo(true),
                    startWith(false)
                )
            )
                .pipe(
                    tap(() => this.setState({ blobOrError: undefined })),
                    switchMap(([{ repoName, commitID, filePath, isLightTheme }, extendHighlightingTimeout]) =>
                        fetchBlob({
                            repoName,
                            commitID,
                            filePath,
                            isLightTheme,
                            disableTimeout: extendHighlightingTimeout,
                        }).pipe(
                            catchError(error => {
                                console.error(error)
                                return [error]
                            })
                        )
                    )
                )
                .subscribe(blobOrError => this.setState({ blobOrError }), err => console.error(err))
        )

        // Clear the NBShare extensions model's component when the blob is no longer shown.
        this.subscriptions.add(() =>
            this.props.extensionsController.services.model.model.next({
                ...this.props.extensionsController.services.model.model.value,
                visibleViewComponents: null,
            })
        )

        this.propsUpdates.next(this.props)
    }

    public componentWillReceiveProps(newProps: Props): void {
        this.propsUpdates.next(newProps)
        if (
            newProps.repoName !== this.props.repoName ||
            newProps.commitID !== this.props.commitID ||
            newProps.filePath !== this.props.filePath ||
            ToggleRenderedFileMode.getModeFromURL(newProps.location) !==
                ToggleRenderedFileMode.getModeFromURL(this.props.location)
        ) {
            this.logViewEvent()
        }
    }

    public componentWillUnmount(): void {
        this.subscriptions.unsubscribe()
    }

    public render(): React.ReactNode {
        if (isErrorLike(this.state.blobOrError)) {
            return (
                <HeroPage icon={AlertCircleIcon} title="Error" subtitle={upperFirst(this.state.blobOrError.message)} />
            )
        }

        let renderMode = ToggleRenderedFileMode.getModeFromURL(this.props.location)
        // If url explicitly asks for a certain rendering mode, renderMode is set to that mode, else it checks:
        // - If file contains richHTML and url does not include a line number: We render in richHTML.
        // - If file does not contain richHTML or the url includes a line number: We render in code view.
        if (!renderMode) {
            renderMode =
                this.state.blobOrError && this.state.blobOrError.richHTML && !parseHash(this.props.location.hash).line
                    ? 'rendered'
                    : 'code'
        }

        // Always render these to avoid UI jitter during loading when switching to a new file.
        const alwaysRender = (
            <>
                <PageTitle title={this.getPageTitle()} />
                <RepoHeaderContributionPortal
                    position="right"
                    priority={20}
                    element={
                        <ToggleHistoryPanel
                            key="toggle-blob-panel"
                            location={this.props.location}
                            history={this.props.history}
                        />
                    }
                    repoHeaderContributionsLifecycleProps={this.props.repoHeaderContributionsLifecycleProps}
                />
                {renderMode === 'code' && (
                    <RepoHeaderContributionPortal
                        position="right"
                        priority={99}
                        element={<ToggleLineWrap key="toggle-line-wrap" onDidUpdate={this.onDidUpdateLineWrap} />}
                        repoHeaderContributionsLifecycleProps={this.props.repoHeaderContributionsLifecycleProps}
                    />
                )}
                {isDiscussionsEnabled(this.props.settingsCascade) && (
                    <RepoHeaderContributionPortal
                        position="right"
                        priority={20}
                        element={
                            <ToggleDiscussionsPanel
                                key="toggle-blob-discussion-panel"
                                location={this.props.location}
                                history={this.props.history}
                            />
                        }
                        repoHeaderContributionsLifecycleProps={this.props.repoHeaderContributionsLifecycleProps}
                    />
                )}
            </>
        )

        if (!this.state.blobOrError) {
            // Render placeholder for layout before content is fetched.
            return <div className="blob-page__placeholder">{alwaysRender}</div>
        }

        return (
            <>
                {alwaysRender}
                {this.state.blobOrError.richHTML && (
                    <RepoHeaderContributionPortal
                        position="right"
                        priority={100}
                        element={
                            <ToggleRenderedFileMode
                                key="toggle-rendered-file-mode"
                                mode={renderMode || 'rendered'}
                                location={this.props.location}
                            />
                        }
                        repoHeaderContributionsLifecycleProps={this.props.repoHeaderContributionsLifecycleProps}
                    />
                )}
                {this.state.blobOrError.richHTML && renderMode === 'rendered' && (
                    <RenderedFile dangerousInnerHTML={this.state.blobOrError.richHTML} location={this.props.location} />
                )}
                {renderMode === 'code' && !this.state.blobOrError.highlight.aborted && (
                    <Blob
                        {...this.props}
                        className="blob-page__blob"
                        content={this.state.blobOrError.content}
                        html={this.state.blobOrError.highlight.html}
                        wrapCode={this.state.wrapCode}
                        renderMode={renderMode}
                    />
                )}
                {!this.state.blobOrError.richHTML && this.state.blobOrError.highlight.aborted && (
                    <div className="blob-page__aborted">
                        <div className="alert alert-info">
                            Syntax-highlighting this file took too long. &nbsp;
                            <button onClick={this.onExtendHighlightingTimeoutClick} className="btn btn-sm btn-primary">
                                Try again
                            </button>
                        </div>
                    </div>
                )}
                <BlobPanel
                    {...this.props}
                    position={
                        lprToRange(parseHash(this.props.location.hash))
                            ? lprToRange(parseHash(this.props.location.hash))!.start
                            : undefined
                    }
                />
            </>
        )
    }

    private onDidUpdateLineWrap = (value: boolean) => this.setState({ wrapCode: value })

    private onExtendHighlightingTimeoutClick = () => this.extendHighlightingTimeoutClicks.next()

    private getPageTitle(): string {
        const repoNameSplit = this.props.repoName.split('/')
        const repoStr = repoNameSplit.length > 2 ? repoNameSplit.slice(1).join('/') : this.props.repoName
        if (this.props.filePath) {
            const fileOrDir = this.props.filePath.split('/').pop()
            return `${fileOrDir} - ${repoStr}`
        }
        return `${repoStr}`
    }
}
