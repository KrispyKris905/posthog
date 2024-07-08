import { combineUrl, router } from 'kea-router'
import { CopyToClipboardInline } from 'lib/components/CopyToClipboard'
import { JSONViewer } from 'lib/components/JSONViewer'
import { Property } from 'lib/components/Property'
import { PropertyKeyInfo } from 'lib/components/PropertyKeyInfo'
import { TaxonomicFilterGroupType } from 'lib/components/TaxonomicFilter/types'
import { TZLabel } from 'lib/components/TZLabel'
import { LemonTag } from 'lib/lemon-ui/LemonTag/LemonTag'
import { Link } from 'lib/lemon-ui/Link'
import { Spinner } from 'lib/lemon-ui/Spinner/Spinner'
import { Tooltip } from 'lib/lemon-ui/Tooltip'
import { autoCaptureEventToDescription } from 'lib/utils'
import { GroupActorDisplay } from 'scenes/persons/GroupActorDisplay'
import { PersonDisplay, PersonDisplayProps } from 'scenes/persons/PersonDisplay'
import { urls } from 'scenes/urls'

import { errorColumn, loadingColumn } from '~/queries/nodes/DataTable/dataTableLogic'
import { renderHogQLX } from '~/queries/nodes/HogQLX/render'
import { DeletePersonButton } from '~/queries/nodes/PersonsNode/DeletePersonButton'
import { DataTableNode, EventsQueryPersonColumn, HasPropertiesNode } from '~/queries/schema'
import { QueryContext } from '~/queries/types'
import { isActorsQuery, isEventsQuery, isHogQLQuery, isPersonsNode, trimQuotes } from '~/queries/utils'
import { AnyPropertyFilter, EventType, PersonType, PropertyFilterType, PropertyOperator } from '~/types'

export function renderColumn(
    key: string,
    value: any,
    record: Record<string, any> | any[],
    query: DataTableNode,
    setQuery?: (query: DataTableNode) => void,
    context?: QueryContext
): JSX.Element | string {
    const queryContextColumnName = key.startsWith('context.columns.') ? trimQuotes(key.substring(16)) : undefined
    const queryContextColumn = queryContextColumnName ? context?.columns?.[queryContextColumnName] : undefined

    if (value === loadingColumn) {
        return <Spinner />
    } else if (value === errorColumn) {
        return <LemonTag color="red">Error</LemonTag>
    } else if (value === null) {
        return (
            <Tooltip title="NULL" placement="right" delayMs={0}>
                <span className="cursor-default" aria-hidden>
                    —
                </span>
            </Tooltip>
        )
    } else if (queryContextColumnName && queryContextColumn?.render) {
        const Component = queryContextColumn?.render
        return <Component record={record} columnName={queryContextColumnName} value={value} query={query} />
    } else if (typeof value === 'object' && Array.isArray(value) && value[0] === '__hx_tag') {
        return renderHogQLX(value)
    } else if (isHogQLQuery(query.source)) {
        if (typeof value === 'string') {
            try {
                if (value.startsWith('{') && value.endsWith('}')) {
                    return (
                        <JSONViewer
                            src={JSON.parse(value)}
                            name={key}
                            collapsed={Object.keys(JSON.stringify(value)).length > 10 ? 0 : 1}
                        />
                    )
                }
                if (value.startsWith('[') && value.endsWith(']')) {
                    return (
                        <JSONViewer
                            src={JSON.parse(value)}
                            name={key}
                            collapsed={JSON.stringify(value).length > 10 ? 0 : 1}
                        />
                    )
                }
            } catch (e) {
                // do nothing
            }
            if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?(?:Z|[+-]\d{2}:\d{2})?$/)) {
                return <TZLabel time={value} showSeconds />
            }
        }
        if (typeof value === 'object') {
            if (Array.isArray(value)) {
                return <JSONViewer src={value} name={key} collapsed={value.length > 10 ? 0 : 1} />
            }
            return <JSONViewer src={value} name={key} collapsed={Object.keys(value).length > 10 ? 0 : 1} />
        }
        return <Property value={value} />
    } else if (key === 'event' && isEventsQuery(query.source)) {
        const resultRow = record as any[]
        const eventRecord = query.source.select.includes('*') ? resultRow[query.source.select.indexOf('*')] : null

        if (value === '$autocapture' && eventRecord) {
            return autoCaptureEventToDescription(eventRecord)
        }
        const content = <PropertyKeyInfo value={value} type={TaxonomicFilterGroupType.Events} />
        const $sentry_url = eventRecord?.properties?.$sentry_url
        return $sentry_url ? (
            <Link to={$sentry_url} target="_blank">
                {content}
            </Link>
        ) : (
            content
        )
    } else if (key === 'timestamp' || key === 'created_at' || key === 'session_start' || key === 'session_end') {
        return <TZLabel time={value} showSeconds />
    } else if (!Array.isArray(record) && key.startsWith('properties.')) {
        // TODO: remove after removing the old events table
        const propertyKey = trimQuotes(key.substring(11))
        if (setQuery && (isEventsQuery(query.source) || isPersonsNode(query.source)) && query.showPropertyFilter) {
            const newProperty: AnyPropertyFilter = {
                key: propertyKey,
                value: record.properties[propertyKey],
                operator: PropertyOperator.Exact,
                type: isPersonsNode(query.source) ? PropertyFilterType.Person : PropertyFilterType.Event,
            }
            const matchingProperty = (query.source.properties || []).find(
                (p) => p.key === newProperty.key && p.type === newProperty.type
            )
            const newProperties = matchingProperty
                ? (query.source.properties || []).filter((p) => p !== matchingProperty)
                : [...(query.source.properties || []), newProperty]
            const newUrl = query.propertiesViaUrl
                ? combineUrl(
                      router.values.location.pathname,
                      {
                          ...router.values.searchParams,
                          properties: newProperties,
                      },
                      router.values.hashParams
                  ).url
                : '#'
            return (
                <Link
                    className="ph-no-capture"
                    to={newUrl}
                    onClick={(e) => {
                        e.preventDefault()
                        setQuery({
                            ...query,
                            source: {
                                ...query.source,
                                properties: newProperties,
                            } as HasPropertiesNode,
                        })
                    }}
                >
                    <Property value={record.properties[propertyKey]} />
                </Link>
            )
        }
        return <Property value={record.properties[propertyKey]} />
    } else if (!Array.isArray(record) && key.startsWith('person.properties.')) {
        // TODO: remove after removing the old events table
        const eventRecord = record as EventType
        const propertyKey = trimQuotes(key.substring(18))
        if (setQuery && isEventsQuery(query.source)) {
            const newProperty: AnyPropertyFilter = {
                key: propertyKey,
                value: eventRecord.person?.properties[propertyKey],
                operator: PropertyOperator.Exact,
                type: PropertyFilterType.Person,
            }
            const matchingProperty = (query.source.properties || []).find(
                (p) => p.key === newProperty.key && p.type === newProperty.type
            )
            const newProperties = matchingProperty
                ? (query.source.properties || []).filter((p) => p !== matchingProperty)
                : [...(query.source.properties || []), newProperty]
            const newUrl = query.propertiesViaUrl
                ? combineUrl(
                      router.values.location.pathname,
                      {
                          ...router.values.searchParams,
                          properties: newProperties,
                      },
                      router.values.hashParams
                  ).url
                : '#'
            return (
                <Link
                    className="ph-no-capture"
                    to={newUrl}
                    onClick={(e) => {
                        e.preventDefault()
                        setQuery({
                            ...query,
                            source: {
                                ...query.source,
                                properties: newProperties,
                            } as HasPropertiesNode,
                        })
                    }}
                >
                    <Property value={eventRecord.person?.properties?.[propertyKey]} />
                </Link>
            )
        }
        return <Property value={eventRecord.person?.properties?.[propertyKey]} />
    } else if (key === 'person') {
        const personRecord = record as PersonType
        const displayProps: PersonDisplayProps = {
            withIcon: true,
            person: record as PersonType,
            noPopover: true,
        }

        if (isEventsQuery(query.source)) {
            displayProps.person = value.distinct_id ? (value as EventsQueryPersonColumn) : value
            displayProps.noPopover = false // If we are in an events list, the popover experience is better
        }

        if (isPersonsNode(query.source) && personRecord.distinct_ids) {
            displayProps.href = urls.personByDistinctId(personRecord.distinct_ids[0])
        }

        if (isActorsQuery(query.source) && value) {
            displayProps.person = value
            displayProps.href = value.distinct_ids?.[0]
                ? urls.personByDistinctId(value.distinct_ids[0])
                : urls.personByUUID(value.id)
        }

        return <PersonDisplay {...displayProps} />
    } else if (key === 'group' && typeof value === 'object') {
        return <GroupActorDisplay actor={value} />
    } else if (key === 'person.$delete' && (isPersonsNode(query.source) || isActorsQuery(query.source))) {
        const personRecord = record as PersonType
        return <DeletePersonButton person={personRecord} />
    } else if (key.startsWith('context.columns.')) {
        const columnName = trimQuotes(key.substring(16)) // 16 = "context.columns.".length
        const Component = context?.columns?.[columnName]?.render
        return Component ? <Component record={record} columnName={columnName} value={value} query={query} /> : ''
    } else if (context?.columns?.[key]) {
        const Component = context?.columns?.[key]?.render
        return Component ? <Component record={record} columnName={key} value={value} query={query} /> : ''
    } else if (key === 'id' && (isPersonsNode(query.source) || isActorsQuery(query.source))) {
        return (
            <CopyToClipboardInline
                explicitValue={String(value)}
                iconStyle={{ color: 'var(--primary)' }}
                description="person id"
            >
                {String(value)}
            </CopyToClipboardInline>
        )
    }
    if (typeof value === 'object') {
        return <JSONViewer src={value} name={null} collapsed={Object.keys(value).length > 10 ? 0 : 1} />
    } else if (
        typeof value === 'string' &&
        ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']')))
    ) {
        try {
            return <JSONViewer src={JSON.parse(value)} name={null} collapsed={Object.keys(value).length > 10 ? 0 : 1} />
        } catch (e) {
            // do nothing
        }
    }
    return String(value)
}
