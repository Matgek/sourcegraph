import { concat, ReplaySubject } from 'rxjs'
import { map, publishReplay, refCount } from 'rxjs/operators'
import { createExtensionHost } from '../../../shared/src/api/extension/worker'
import { gql } from '../../../shared/src/graphql/graphql'
import * as GQL from '../../../shared/src/graphql/schema'
import { PlatformContext } from '../../../shared/src/platform/context'
import { mutateSettings, updateSettings } from '../../../shared/src/settings/edit'
import { gqlToCascade } from '../../../shared/src/settings/settings'
import { LocalStorageSubject } from '../../../shared/src/util/LocalStorageSubject'
import { toPrettyBlobURL } from '../../../shared/src/util/url'
import { requestGraphQL } from '../backend/graphql'
import { Tooltip } from '../components/tooltip/Tooltip'
import { fetchViewerSettings } from '../user/settings/backend'

/**
 * Creates the {@link PlatformContext} for the web app.
 */
export function createPlatformContext(): PlatformContext {
    const updatedSettings = new ReplaySubject<GQL.ISettingsCascade>(1)
    const context: PlatformContext = {
        settings: concat(fetchViewerSettings(), updatedSettings).pipe(
            map(gqlToCascade),
            publishReplay(1),
            refCount()
        ),
        updateSettings: async (subject, edit) => {
            // Unauthenticated users can't update settings. (In the browser extension, they can update client
            // settings even when not authenticated. The difference in behavior in the web app vs. browser
            // extension is why this logic lives here and not in shared/.)
            if (!window.context.isAuthenticatedUser) {
                const editDescription =
                    typeof edit === 'string' ? 'edit settings' : `update setting ` + '`' + edit.path.join('.') + '`'
                const u = new URL(window.context.externalURL)
                throw new Error(
                    `Unable to ${editDescription} because you are not signed in.` +
                        '\n\n' +
                        `[**Sign into NBShare${
                            u.hostname === 'sourcegraph.com' ? '' : ` on ${u.host}`
                        }**](${`${u.href.replace(/\/$/, '')}/sign-in`})`
                )
            }

            try {
                await updateSettings(context, subject, edit, mutateSettings)
            } catch (error) {
                if ('message' in error && /version mismatch/.test(error.message)) {
                    // The user probably edited the settings in another tab, so
                    // try once more.
                    updatedSettings.next(await fetchViewerSettings().toPromise())
                    await updateSettings(context, subject, edit, mutateSettings)
                }
            }
            updatedSettings.next(await fetchViewerSettings().toPromise())
        },
        queryGraphQL: (request, variables) =>
            requestGraphQL(
                gql`
                    ${request}
                `,
                variables
            ),
        forceUpdateTooltip: () => Tooltip.forceUpdate(),
        createExtensionHost: () => createExtensionHost({ wrapEndpoints: false }),
        urlToFile: toPrettyBlobURL,
        getScriptURLForExtension: bundleURL => bundleURL,
        sourcegraphURL: window.context.externalURL,
        clientApplication: 'sourcegraph',
        sideloadedExtensionURL: new LocalStorageSubject<string | null>('sideloadedExtensionURL', null),
    }
    return context
}
