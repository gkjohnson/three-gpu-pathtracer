/**
 * Returns every numeric limit exposed by the adapter. `GPUSupportedLimits` values are
 * implemented as prototype getters in some browsers, so `Object.keys` and object spread
 * do not reliably include them.
 *
 * @param {GPUAdapter} adapter
 * @returns {Record<string, number>}
 */
export function getMaxDeviceLimits( adapter ) {

	if ( ! adapter || ! adapter.limits ) {

		throw new TypeError( 'getMaxDeviceLimits: A valid GPUAdapter is required.' );

	}

	const limits = {};
	const visited = new Set();
	let object = adapter.limits;

	while ( object && object !== Object.prototype ) {

		for ( const name of Object.getOwnPropertyNames( object ) ) {

			if ( name === 'constructor' || visited.has( name ) ) {

				continue;

			}

			visited.add( name );

			let value;
			try {

				value = adapter.limits[ name ];

			} catch {

				continue;

			}

			if ( typeof value === 'number' && Number.isFinite( value ) ) {

				limits[ name ] = value;

			}

		}

		object = Object.getPrototypeOf( object );

	}

	return limits;

}
