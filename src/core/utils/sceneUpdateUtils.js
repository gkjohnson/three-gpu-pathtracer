function uuidSort( a, b ) {

	if ( a.uuid < b.uuid ) return 1;
	if ( a.uuid > b.uuid ) return - 1;
	return 0;

}

// we must hash the texture to determine uniqueness using the encoding, as well, because the
// when rendering each texture to the texture array they must have a consistent color space.
export function getTextureHash( t ) {

	return `${ t.source.uuid }:${ t.colorSpace }`;

}

export function getLights( scene ) {

	const lights = [];
	scene.traverseVisible( c => {

		if (
			c.isRectAreaLight ||
			c.isSpotLight ||
			c.isPointLight ||
			c.isDirectionalLight ||
			c.isSunLight
		) {

			lights.push( c );

		}

	} );

	return lights.sort( uuidSort );

}
