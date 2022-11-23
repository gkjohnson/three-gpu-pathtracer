export function reduceTexturesToUniqueSources( textures ) {

	const sourceSet = new Set();
	const result = [];
	for ( let i = 0, l = textures.length; i < l; i ++ ) {

		const tex = textures[ i ];
		if ( ! sourceSet.has( tex.source ) ) {

			result.push( tex );

		}

	}

	return result;

}
