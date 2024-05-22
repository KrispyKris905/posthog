import { actions, afterMount, kea, listeners, path, props, reducers, selectors } from 'kea'
import { loaders } from 'kea-loaders'
import { combineUrl, encodeParams } from 'kea-router'
import { lemonToast } from 'lib/lemon-ui/LemonToast/LemonToast'

import { toolbarPosthogJS } from '~/toolbar/toolbarPosthogJS'
import { ToolbarProps } from '~/types'

import type { toolbarConfigLogicType } from './toolbarConfigLogicType'
import { LOCALSTORAGE_KEY } from './utils'

export type ToolbarAuthorizationState = Pick<ToolbarProps, 'authorizationCode' | 'accessToken'>

export const toolbarConfigLogic = kea<toolbarConfigLogicType>([
    path(['toolbar', 'toolbarConfigLogic']),
    props({} as ToolbarProps),

    actions({
        authenticate: true,
        logout: true,
        tokenExpired: true,
        clearUserIntent: true,
        showButton: true,
        hideButton: true,
        persistConfig: true,
        authorize: true,
        checkAuthorization: true,
    }),

    reducers(({ props }) => ({
        // TRICKY: We cache a copy of the props. This allows us to connect the logic without passing the props in - only the top level caller has to do this.
        props: [props],
        temporaryToken: [
            props.temporaryToken || null,
            { logout: () => null, tokenExpired: () => null, authenticate: () => null },
        ],
        actionId: [props.actionId || null, { logout: () => null, clearUserIntent: () => null }],
        userIntent: [props.userIntent || null, { logout: () => null, clearUserIntent: () => null }],
        buttonVisible: [true, { showButton: () => true, hideButton: () => false, logout: () => false }],
    })),

    selectors({
        posthog: [(s) => [s.props], (props) => props.posthog ?? null],
        apiURL: [
            (s) => [s.props],
            (props: ToolbarProps) => `${props.apiURL?.endsWith('/') ? props.apiURL.replace(/\/+$/, '') : props.apiURL}`,
        ],
        jsURL: [
            (s) => [s.props, s.apiURL],
            (props: ToolbarProps, apiUrl) =>
                `${props.jsURL ? (props.jsURL.endsWith('/') ? props.jsURL.replace(/\/+$/, '') : props.jsURL) : apiUrl}`,
        ],
        dataAttributes: [(s) => [s.props], (props): string[] => props.dataAttributes ?? []],
        isAuthenticated: [(s) => [s.temporaryToken], (temporaryToken) => !!temporaryToken],
    }),

    loaders(({ values, actions, props }) => ({
        authorization: [
            {
                authorizationCode: props.authorizationCode || null,
                accessToken: props.accessToken || null,
            } as ToolbarAuthorizationState,
            {
                authorize: async () => {
                    // TODO: Error handling
                    const res = await toolbarFetch(`/api/client_authorization/start`, 'POST')

                    if (res.status !== 200) {
                        lemonToast.error('Failed to authorize:', await res.json())
                        throw new Error('Failed to authorize')
                    }

                    const payload = await res.json()

                    console.log('PAYLOAD', payload)
                    return {
                        authorizationCode: payload.code,
                    }
                },
                checkAuthorization: async () => {
                    const { authorizationCode } = values.authorization

                    if (!authorizationCode) {
                        return {}
                    }
                    const res = await toolbarFetch(`/api/client_authorization/check?code=${authorizationCode}`)
                    if (res.status !== 200) {
                        throw new Error('Something went wrong. Please re-authenticate')
                    }
                    const payload = await res.json()
                    lemonToast.success('PostHog Toolbar authorized!')

                    return {
                        accessToken: payload.access_token,
                    }
                },
            },
        ],
    })),

    listeners(({ values, actions }) => ({
        authenticate: async () => {
            actions.authorize()
            // toolbarPosthogJS.capture('toolbar authenticate', { is_authenticated: values.isAuthenticated })
            // const encodedUrl = encodeURIComponent(window.location.href)
            // // TODO: Error handling
            // const authorizationCode = await toolbarFetch(`/api/client_authorization/start`, 'POST')
            //     .then((response) => response.json())
            //     .then((data) => data.code)
            // actions.setAuthenticationState({ authorizationCode })
            // actions.persistConfig()
            // window.location.href = `${values.apiURL}/client_authorization/?code=${authorizationCode}&redirect_url=${encodedUrl}&client_id=toolbar`
        },

        authorizeSuccess: async () => {
            // TRICKY: Need to do on the next tick to ensure the loader values are ready
            toolbarPosthogJS.capture('toolbar authenticate', { is_authenticated: values.isAuthenticated })
            const encodedUrl = encodeURIComponent(window.location.href)
            actions.persistConfig()
            window.location.href = `${values.apiURL}/client_authorization/?code=${values.authorization.authorizationCode}&redirect_url=${encodedUrl}&client_id=toolbar`
        },

        checkAuthorizationSuccess: () => {
            actions.persistConfig()
        },

        logout: () => {
            toolbarPosthogJS.capture('toolbar logout')
            localStorage.removeItem(LOCALSTORAGE_KEY)
        },
        tokenExpired: () => {
            toolbarPosthogJS.capture('toolbar token expired')
            console.warn('PostHog Toolbar API token expired. Clearing session.')
            if (values.props.source !== 'localstorage') {
                lemonToast.error('PostHog Toolbar API token expired.')
            }
            actions.persistConfig()
        },

        persistConfig: () => {
            // Most params we don't change, only those that we may have modified during the session
            const toolbarParams: ToolbarProps = {
                ...values.props,
                temporaryToken: values.temporaryToken ?? undefined,
                actionId: values.actionId ?? undefined,
                userIntent: values.userIntent ?? undefined,
                posthog: undefined,
                featureFlags: undefined,
                accessToken: values.authorization?.accessToken ?? undefined,
                authorizationCode: values.authorization?.authorizationCode ?? undefined,
            }

            console.log('PERSISTING CONFIG', toolbarParams)

            localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(toolbarParams))
        },
    })),

    afterMount(({ props, values, actions }) => {
        if (props.instrument) {
            const distinctId = props.distinctId

            void toolbarPosthogJS.optIn()

            if (distinctId) {
                toolbarPosthogJS.identify(distinctId, props.userEmail ? { email: props.userEmail } : {})
            }
        }

        if (values.authorization.authorizationCode) {
            actions.checkAuthorization()
        }
        toolbarPosthogJS.capture('toolbar loaded', { is_authenticated: values.isAuthenticated })
    }),
])

export async function toolbarFetch(
    url: string,
    method: string = 'GET',
    payload?: Record<string, any>,
    /*
     allows caller to control how the provided URL is altered before use
     if "full" then the payload and URL are taken apart and reconstructed
     if "use-as-provided" then the URL is used as-is, and the payload is not used
     this is because the heatmapLogic needs more control over how the query parameters are constructed
    */
    urlConstruction: 'full' | 'use-as-provided' = 'full'
): Promise<Response> {
    const temporaryToken = toolbarConfigLogic.findMounted()?.values.temporaryToken
    const apiURL = toolbarConfigLogic.findMounted()?.values.apiURL

    let fullUrl: string
    if (urlConstruction === 'use-as-provided') {
        fullUrl = url
    } else {
        const { pathname, searchParams } = combineUrl(url)
        const params = { ...searchParams, temporary_token: temporaryToken }
        fullUrl = `${apiURL}${pathname}${encodeParams(params, '?')}`
    }

    const payloadData = payload
        ? {
              body: JSON.stringify(payload),
              headers: {
                  'Content-Type': 'application/json',
              },
          }
        : {}

    const response = await fetch(fullUrl, {
        method,
        ...payloadData,
    })
    if (response.status === 403) {
        const responseData = await response.json()
        if (responseData.detail === "You don't have access to the project.") {
            toolbarConfigLogic.actions.authenticate()
        }
    }
    if (response.status == 401) {
        toolbarConfigLogic.actions.tokenExpired()
    }
    return response
}
