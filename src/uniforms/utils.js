// we must hash the texture to determine uniqueness using the encoding, as well, because the
// when rendering each texture to the texture array they must have a consistent color space.
export function getTextureHash( t ) {

	return `${ t.source.uuid }:${ t.encoding }`;

}

// reduce the set of textures to just those with a unique source while retaining
// the order of the textures.
export function reduceTexturesToUniqueSources( textures ) {

	const sourceSet = new Set();
	const result = [];
	for ( let i = 0, l = textures.length; i < l; i ++ ) {

		const tex = textures[ i ];
		const hash = getTextureHash( tex );
		if ( ! sourceSet.has( hash ) ) {

			sourceSet.add( hash );
			result.push( tex );

		}

	}

	return result;

}
