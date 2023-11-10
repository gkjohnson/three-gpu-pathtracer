import { DataUtils } from 'three';


export function toHalfFloatArray( f32Array ) {

	const f16Array = new Uint16Array( f32Array.length );
	for ( let i = 0, n = f32Array.length; i < n; ++ i ) {

		f16Array[ i ] = DataUtils.toHalfFloat( f32Array[ i ] );

	}

	return f16Array;

}
