const CONFIG_URL = 'https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/config.json';
( async () => {

	const containerEl = document.getElementById( 'container' );
	const req = await fetch( CONFIG_URL );
	const { scenarios } = await req.json();
	const imageType = window.location.hash.replace( /^#/, '' ) || 'model-viewer';

	scenarios.forEach( s => {

		const name = s.name;
		const url1 = `https://raw.githubusercontent.com/gkjohnson/three-gpu-pathtracer/screenshots/screenshots/golden/${ name }.png`;
		const url2 = `https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/goldens/${ name }/${ imageType }-golden.png`;
		containerEl.innerHTML += `
			<div>
				<h1>${ s.name }</h1>
				<div class="img-wrapper">
					<a href="${ url1 }" target="_blank"><img src="${ url1 }" /></a>
					<a href="${ url2 }" target="_blank"><img src="${ url2 }" /></a>
				</div>
			</div>
		`;

	} );

} )();
