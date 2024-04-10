// https://www.geeksforgeeks.org/how-to-create-hash-from-string-in-javascript/
// https://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript
export function bufferToHash( buffer ) {

	let hash = 0;

	if ( buffer.byteLength !== 0 ) {

		const uintArray = new Uint8Array( buffer );
		for ( let i = 0; i < buffer.byteLength; i ++ ) {

			const byte = uintArray[ i ];
			hash = ( ( hash << 5 ) - hash ) + byte;
			hash |= 0;

		}

	}

	return hash;

}
