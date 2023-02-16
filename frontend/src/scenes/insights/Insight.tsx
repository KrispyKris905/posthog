import './Insight.scss'
import { useEffect } from 'react'
import { BindLogic, useActions, useMountedLogic, useValues } from 'kea'
import { insightSceneLogic } from 'scenes/insights/insightSceneLogic'
import { insightLogic } from './insightLogic'
import { insightCommandLogic } from './insightCommandLogic'
import { insightDataLogic } from './insightDataLogic'
import { InsightShortId, InsightType, ItemMode } from '~/types'
import { InsightsNav } from './InsightsNav'
import { InsightContainer } from 'scenes/insights/InsightContainer'
import { InsightSkeleton } from 'scenes/insights/InsightSkeleton'
import { EditorFilters } from './EditorFilters/EditorFilters'
import clsx from 'clsx'
import { Query } from '~/queries/Query/Query'
import { InsightPageHeader } from 'scenes/insights/InsightPageHeader'
import { QueryEditor } from '~/queries/QueryEditor/QueryEditor'
import { insightQueryEditorLogic } from './insightQueryEditorLogic'

export interface InsightSceneProps {
    insightId: InsightShortId | 'new'
}

export function Insight({ insightId }: InsightSceneProps): JSX.Element {
    // insightSceneLogic
    const { insightMode } = useValues(insightSceneLogic)

    // insightLogic
    const logic = insightLogic({ dashboardItemId: insightId || 'new' })
    const {
        insightProps,
        insightLoading,
        filtersKnown,
        filters,
        isUsingDataExploration,
        isUsingQueryBasedInsights,
        erroredQueryId,
        isFilterBasedInsight,
        isQueryBasedInsight,
        activeView,
    } = useValues(logic)
    const { reportInsightViewedForRecentInsights, abortAnyRunningQuery, loadResults } = useActions(logic)

    // insightDataLogic
    const { query: insightVizQuery } = useValues(insightDataLogic(insightProps))
    const { setQuery: insightVizSetQuery } = useActions(insightDataLogic(insightProps))

    const { query: insightEditorQuery } = useValues(
        insightQueryEditorLogic({ ...insightProps, query: insightVizQuery })
    )
    const { setQuery: insightEditorSetQuery } = useActions(
        insightQueryEditorLogic({ ...insightProps, query: insightVizQuery })
    )
    // TODO - separate presentation of insight with viz query from insight with query
    let query = insightVizQuery
    let setQuery = insightVizSetQuery
    if (!!insightEditorQuery && isQueryBasedInsight) {
        query = insightEditorQuery
        setQuery = insightEditorSetQuery
    }

    // other logics
    useMountedLogic(insightCommandLogic(insightProps))

    useEffect(() => {
        reportInsightViewedForRecentInsights()
    }, [insightId])

    useEffect(() => {
        // if users navigate away from insights then we may cancel an API call
        // and when they come back they may see an error state, so clear it
        if (!!erroredQueryId) {
            loadResults()
        }
        return () => {
            // request cancellation of any running queries when this component is no longer in the dom
            abortAnyRunningQuery()
        }
    }, [])
    // if this is a non-viz query-based insight e.g. an events table then don't show the insight editing chrome
    const showFilterEditing = activeView !== InsightType.QUERY && isFilterBasedInsight

    // Show the skeleton if loading an insight for which we only know the id
    // This helps with the UX flickering and showing placeholder "name" text.
    if (insightId !== 'new' && insightLoading && !filtersKnown) {
        return <InsightSkeleton />
    }

    const insightScene = (
        <div className={'insights-page'}>
            <InsightPageHeader insightId={insightId} />

            {insightMode === ItemMode.Edit && <InsightsNav />}

            {isUsingDataExploration || (isUsingQueryBasedInsights && isQueryBasedInsight) ? (
                <>
                    {insightMode === ItemMode.Edit && isQueryBasedInsight && (
                        <>
                            <QueryEditor
                                query={JSON.stringify(query, null, 4)}
                                setQuery={setQuery ? (query) => setQuery(JSON.parse(query)) : undefined}
                            />
                        </>
                    )}
                    <Query query={query} setQuery={setQuery} />
                </>
            ) : (
                <>
                    <div
                        className={clsx('insight-wrapper', {
                            'insight-wrapper--singlecolumn': filters.insight === InsightType.FUNNELS,
                        })}
                    >
                        <EditorFilters
                            insightProps={insightProps}
                            showing={showFilterEditing && insightMode === ItemMode.Edit}
                        />
                        <div className="insights-container" data-attr="insight-view">
                            <InsightContainer insightMode={insightMode} />
                        </div>
                    </div>
                </>
            )}
        </div>
    )

    return (
        <BindLogic logic={insightLogic} props={insightProps}>
            {insightScene}
        </BindLogic>
    )
}
