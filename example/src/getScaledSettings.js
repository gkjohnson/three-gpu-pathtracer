export function getScaledSettings() {

	let tiles = 3;
	let renderScale = 1;

	// adjust performance parameters for mobile
	const aspectRatio = window.innerWidth / window.innerHeight;
	if ( aspectRatio < 0.65 ) {

		tiles = 4;
		renderScale = 1 / window.devicePixelRatio;

	}

	return { tiles, renderScale };

}
