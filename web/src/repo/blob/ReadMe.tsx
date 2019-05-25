import * as H from 'history'
import { isEqual, pick } from 'lodash'
import * as React from 'react'
import { combineLatest, Observable, Subject, Subscription } from 'rxjs'
import { catchError, distinctUntilChanged, map, mapTo, startWith, switchMap, tap } from 'rxjs/operators'
import { gql } from '../../../../shared/src/graphql/graphql'
import * as GQL from '../../../../shared/src/graphql/schema'
import { createAggregateError, ErrorLike, isErrorLike } from '../../../../shared/src/util/errors'
import { memoizeObservable } from '../../../../shared/src/util/memoizeObservable'
import { makeRepoURI, ParsedRepoURI } from '../../../../shared/src/util/url'
import { queryGraphQL } from '../../backend/graphql'
import { eventLogger } from '../../tracking/eventLogger'
import { ToggleLineWrap } from './actions/ToggleLineWrap'
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

interface Props {
    repoName: string
    commitID: string
    filePath: string
    isLightTheme: boolean
    disableTimeout: boolean
    location: H.Location
}

interface State {
    wrapCode: boolean

    /**
     * The blob data or error that happened.
     * undefined while loading.
     */
    blobOrError?: GQL.IGitBlob | ErrorLike
}

export class ReadMe extends React.PureComponent<Props, State> {
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
        eventLogger.logViewEvent('ReadMe', { fileShown: true })
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

        this.propsUpdates.next(this.props)
    }

    public componentWillUnmount(): void {
        this.subscriptions.unsubscribe()
    }

    public render(): React.ReactNode {
        if (isErrorLike(this.state.blobOrError)) {
            return null
        }

        if (!this.state.blobOrError) {
            // Render placeholder for layout before content is fetched.
            return <div className="blob-page__placeholder" />
        }

        return (
            <>
                {this.state.blobOrError.richHTML && (
                    <section className="tree-page__section">
                        <h3 className="tree-page__section-header">README.md</h3>
                        <RenderedFile
                            dangerousInnerHTML={this.state.blobOrError.richHTML}
                            location={this.props.location}
                        />
                    </section>
                )}
            </>
        )
    }
}
