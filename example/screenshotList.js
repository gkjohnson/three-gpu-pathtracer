const CONFIG_URL = 'https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/config.json';
const COMMITS_URL = 'https://api.github.com/repos/gkjohnson/three-gpu-pathtracer/commits?sha=screenshots';

( async () => {

	const containerEl = document.getElementById( 'container' );
	const { scenarios } = await ( await fetch( CONFIG_URL ) ).json();
	const commits = await ( await fetch( COMMITS_URL ) ).json();
	const latestSha = commits[ 0 ].sha;
	let imageType = window.location.hash.replace( /^#/, '' ) || 'model-viewer';

	const selectionBox = document.querySelector( 'select' );
	selectionBox.value = imageType;
	selectionBox.addEventListener( 'change', () => {

		window.location.hash = selectionBox.value;
		imageType = selectionBox.value;
		rebuildList();

	} );
	document.body.style.visibility = 'visible';

	const largeImageBox = document.querySelector( 'input[type="checkbox"]' );
	largeImageBox.addEventListener( 'change', () => {

		if ( largeImageBox.checked ) {

			containerEl.classList.add( 'large-images' );

		} else {

			containerEl.classList.remove( 'large-images' );

		}

	} );

	rebuildList();

	function rebuildList() {

		containerEl.innerHTML = '';
		scenarios.forEach( s => {

			const name = s.name;
			const url1 = `https://raw.githubusercontent.com/gkjohnson/three-gpu-pathtracer/${ latestSha }/screenshots/golden/${ name }.png`;
			let url2;
			if ( imageType === 'prior-commit' ) {

				url2 = `https://raw.githubusercontent.com/gkjohnson/three-gpu-pathtracer/${ commits[ 1 ].sha }/screenshots/golden/${ name }.png`;

			} else {

				url2 = `https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/goldens/${ name }/${ imageType }-golden.png`;

			}

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

	}

} )();
