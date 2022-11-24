// reduce the set of textures to just those with a unique source while retaining
// the order of the textures.
export function reduceTexturesToUniqueSources( textures ) {

	const sourceSet = new Set();
	const result = [];
	for ( let i = 0, l = textures.length; i < l; i ++ ) {

		const tex = textures[ i ];
		if ( ! sourceSet.has( tex.source ) ) {

			sourceSet.add( tex.source );
			result.push( tex );

		}

	}

	return result;

}
