import {
	Elysia,
	type Context,
	type TraceEvent,
	type TraceProcess
} from 'elysia'

type MaybePromise<T> = T | Promise<T>

export interface ServerTimingOptions {
	/**
	 * Should Elysia report data back to client via 'Server-Sent-Event'
	 */
	report?: boolean
	/**
	 * Allow Server Timing to log specified life-cycle events
	 */
	trace?: {
		/**
		 * Capture duration from request
		 *
		 * @default true
		 */
		request?: boolean
		/**
		 * Capture duration from parse
		 *
		 * @default true
		 */
		parse?: boolean
		/**
		 * Capture duration from transform
		 *
		 * @default true
		 */
		transform?: boolean
		/**
		 * Capture duration from beforeHandle
		 *
		 * @default true
		 */
		beforeHandle?: boolean
		/**
		 * Capture duration from handle
		 *
		 * @default true
		 */
		handle?: boolean
		/**
		 * Capture duration from afterHandle
		 *
		 * @default true
		 */
		afterHandle?: boolean
		/**
		 * Capture duration from mapResponse
		 *
		 * @default true
		 */
		error?: boolean
		/**
		 * Capture duration from mapResponse
		 *
		 * @default true
		 */
		mapResponse?: boolean
		/**
		 * Capture total duration from start to finish
		 *
		 * @default true
		 */
		total?: boolean
	}
	/**
	 * Determine whether or not Server Timing should be enabled
	 *
	 * @default NODE_ENV !== 'production'
	 */
	enabled?: boolean
	/**
	 * A condition whether server timing should be log
	 *
	 * @default undefined
	 */
	allow?:
		| MaybePromise<boolean>
		| ((context: Omit<Context, 'path'>) => MaybePromise<boolean>)
}

const getLabel = (
	event: TraceEvent,
	listener: (
		callback: (process: TraceProcess<'begin', true>) => unknown
	) => unknown,
	write: (value: string) => void
) => {
	listener(async function traceEventListener({ onStop, onEvent, total }) {
		let label = ''

		if (total === 0) return

		onEvent(function eventProcessor({ name, index, onStop }) {
			onStop(({ elapsed }) => {
				label += `${event}.${index}.${name || 'anon'};dur=${elapsed},`
			})
		})

		onStop(function recordEventTiming({ elapsed }) {
			label += `${event};dur=${elapsed},`

			write(label)
		})
	})
}

export const serverTiming = ({
	allow,
	enabled = process.env.NODE_ENV !== 'production',
	trace: {
		request: traceRequest = true,
		parse: traceParse = true,
		transform: traceTransform = true,
		beforeHandle: traceBeforeHandle = true,
		handle: traceHandle = true,
		afterHandle: traceAfterHandle = true,
		error: traceError = true,
		mapResponse: traceMapResponse = true,
		total: traceTotal = true
	} = {}
}: ServerTimingOptions = {}) => {
	const app = new Elysia()

	if (enabled) {
		app.trace(
			{ as: 'global' },
			async function serverTimingTraceHandler({
				onRequest,
				onParse,
				onTransform,
				onBeforeHandle,
				onHandle,
				onAfterHandle,
				onMapResponse,
				onError,
				set,
				context,
				context: {
					request: { method }
				}
			}) {
				let label = ''

				const write = (nextValue: string) => {
					label += nextValue
				}

				let start: number

				onRequest(function captureRequestStart({ begin }) {
					start = begin
				})

				if (traceRequest) getLabel('request', onRequest, write)
				if (traceParse) getLabel('parse', onParse, write)
				if (traceTransform) getLabel('transform', onTransform, write)
				if (traceBeforeHandle)
					getLabel('beforeHandle', onBeforeHandle, write)
				if (traceAfterHandle)
					getLabel('afterHandle', onAfterHandle, write)
				if (traceError) getLabel('error', onError, write)
				if (traceMapResponse)
					getLabel('mapResponse', onMapResponse, write)

				if (traceHandle)
					onHandle(({ name, onStop }) => {
						onStop(({ elapsed }) => {
							label += `handle.${name};dur=${elapsed},`
						})
					})

				onMapResponse(function setupResponseTiming({ onStop }) {
					onStop(async function finalizeServerTiming({ end }) {
						let allowed = allow
						if (allowed instanceof Promise) allowed = await allowed

						if (traceTotal) label += `total;dur=${end - start}`
						else label = label.slice(0, -1)

						// ? Must wait until request is reported
						switch (typeof allowed) {
							case 'boolean':
								if (allowed === false)
									delete set.headers['Server-Timing']

								set.headers['Server-Timing'] = label

								break

							case 'function':
								if ((await allowed(context)) === false)
									delete set.headers['Server-Timing']

								set.headers['Server-Timing'] = label

								break

							default:
								set.headers['Server-Timing'] = label
						}
					})
				})
			}
		)
	}

	return app
}

export default serverTiming
