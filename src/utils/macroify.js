export function macroify( contents ) {

	return contents
		.trim()
		.replace( /\/\/.*[\n\r]/g, '' )
		.split( /[\n\r]+/ )
		.join( '\\\n' ) + '\\\n';

}
