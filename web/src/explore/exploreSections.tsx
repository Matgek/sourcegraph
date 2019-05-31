import React from 'react'
const ExtensionViewsExploreSection = React.lazy(async () => ({
    default: (await import('../extensions/explore/ExtensionViewsExploreSection')).ExtensionViewsExploreSection,
}))
const IntegrationsExploreSection = React.lazy(async () => ({
    default: (await import('../integrations/explore/IntegrationsExploreSection')).IntegrationsExploreSection,
}))
const RepositoriesExploreSection = React.lazy(async () => ({
    default: (await import('../repo/explore/RepositoriesExploreSection')).RepositoriesExploreSection,
}))
const SavedSearchesExploreSection = React.lazy(async () => ({
    default: (await import('../search/saved-queries/explore/SavedSearchesExploreSection')).SavedSearchesExploreSection,
}))
const SiteUsageExploreSection = React.lazy(async () => ({
    default: (await import('../usageStatistics/explore/SiteUsageExploreSection')).SiteUsageExploreSection,
}))
import { ExploreSectionDescriptor } from './ExploreArea'

export const exploreSections: ReadonlyArray<ExploreSectionDescriptor> = [
    {
        render: props => <ExtensionViewsExploreSection {...props} />,
    },
    {
        render: props =>
            props.authenticatedUser && props.authenticatedUser.siteAdmin ? (
                <IntegrationsExploreSection {...props} />
            ) : null,
    },
    {
        render: props => <RepositoriesExploreSection {...props} />,
    },
    {
        render: props => <SavedSearchesExploreSection {...props} />,
    },
    {
        render: props =>
            props.authenticatedUser && props.authenticatedUser.siteAdmin ? (
                <SiteUsageExploreSection {...props} />
            ) : null,
        condition: ({ authenticatedUser }) =>
            (!window.context.sourcegraphDotComMode || window.context.debug) && !!authenticatedUser,
    },
]
