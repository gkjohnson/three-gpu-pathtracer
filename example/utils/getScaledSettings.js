export function getScaledSettings() {

	let tiles = 2;
	let renderScale = Math.max( 1 / window.devicePixelRatio, 0.5 );

	// adjust performance parameters for mobile
	const aspectRatio = window.innerWidth / window.innerHeight;
	if ( aspectRatio < 0.65 ) {

		tiles = 3;
		renderScale = 1 / window.devicePixelRatio;

	}

	return { tiles, renderScale };

}
