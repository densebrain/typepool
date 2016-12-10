import * as Bluebird from 'bluebird'
import { isFunction } from "typeguard"

/**
 * Update global promise definition
 */
declare global {
	interface CancelablePromiseResolver<T> extends Bluebird.Resolver<T> {
		isCancelled():boolean
		getResult():T
		cancel():void
		onCancel(cancelCallback:(CancelablePromiseResolver) => any):void
	}
	
	// interface Bluebird<T> {
	// 	static setImmediate():Bluebird<void>
	// 	static defer():CancelablePromiseResolver<any>
	// 	static defer<T>():CancelablePromiseResolver<T>
	// }
	
}

/**
 * Extend bluebird with custom defer() and setImmediate
 */
Object.assign(Bluebird as any, {
	defer() {
		let
			resolve,
			reject,
			result,
			onCancel,
			ref,
			cancelled = false,
			cancelCallbacks = []
		
		const promise = new Bluebird(function (resolver, rejecter, onCancelRegistrar) {
			resolve = (resolvedResult) => {
				result = resolvedResult
				return resolver(resolvedResult)
			}
			reject = rejecter
			onCancel = onCancelRegistrar
			if (isFunction(onCancel)) {
				onCancel(() => {
					cancelled = true
					cancelCallbacks.forEach(it => it(ref))
				})
			}
		});
		
		ref = {
			resolve: resolve,
			reject: reject,
			cancel: () => {
				!cancelled && !promise.isResolved() && !promise.isRejected() &&
				promise.cancel()
			},
			promise: promise,
			getResult: () => result,
			isCancelled: () => cancelled,
			onCancel: (callback) => cancelCallbacks.push(callback)
		}
		
		return ref
	},
	
	setImmediate: function () {
		return new Promise<void>(resolve => {
			setImmediate(() => resolve())
		})
	}
})






export default Bluebird