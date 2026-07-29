import * as THREE from 'three/webgpu';
import { wgslFn } from 'three/tsl';
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { GraphMaterial } from '../src/webgpu/materials/GraphMaterial.js';
import { ggxDistributionFunc, ggxShadowMaskG1Func, ggxLambdaFunc, ggxReflectionAdjustedPDFFunc } from '../src/webgpu/nodes/ggx.wgsl.js';
import { constants } from '../src/webgpu/nodes/structs.wgsl.js';

// Graph the ggx functions against roughness ( x ) for a fixed incident angle, mirroring the
// GLSL variant of this example: wi = normalize( vec3( 1 ) ), half vector = +Z.
const COS_THETA = 1 / Math.sqrt( 3 );
const SIN_THETA = Math.sqrt( 1 - COS_THETA * COS_THETA );

// each graph slot is a wgsl function of the form "fn( x: f32 ) -> f32"
const graphs = [

	wgslFn( /* wgsl */`
		fn graphGgxPdf( x: f32 ) -> f32 {

			let V = vec3f( ${ SIN_THETA }, 0.0, ${ COS_THETA } );
			let H = vec3f( 0.0, 0.0, 1.0 );
			let alpha = vec2f( x );
			return ggxReflectionAdjustedPDF( V, H, alpha );

		}
	`, [ ggxReflectionAdjustedPDFFunc, constants ] ),

	wgslFn( /* wgsl */`
		fn graphGgxDistribution( x: f32 ) -> f32 {

			let H = vec3f( 0.0, 0.0, 1.0 );
			return ggxDistribution( H, vec2f( x ) );

		}
	`, [ ggxDistributionFunc, constants ] ),

	wgslFn( /* wgsl */`
		fn graphGgxShadowMaskG1( x: f32 ) -> f32 {

			let V = vec3f( ${ SIN_THETA }, 0.0, ${ COS_THETA } );
			return ggxShadowMaskG1( V, vec2f( x ) );

		}
	`, [ ggxShadowMaskG1Func ] ),

	wgslFn( /* wgsl */`
		fn graphGgxLambda( x: f32 ) -> f32 {

			let V = vec3f( ${ SIN_THETA }, 0.0, ${ COS_THETA } );
			return ggxLambda( V, vec2f( x ) );

		}
	`, [ ggxLambdaFunc ] ),

];

let camera, scene, renderer, plane;
let cameraCenter;
let zoom = 10;
let dataEl, dataContainerEl, valuesEl;
let readingValues = false;
const params = {
	aspect: 1,
	display: [],
	reset() {

		zoom = 10;
		cameraCenter.set(
			- zoom * 0.5 + zoom * 0.05,
			getAspect() * zoom * 0.5 - zoom * 0.05,
		);

	}
};

init();

// init
async function init() {

	dataContainerEl = document.getElementById( 'dataContainer' );
	dataEl = document.getElementById( 'data' );

	// readout for the graph values at the cursor position
	valuesEl = document.createElement( 'div' );
	valuesEl.style.cssText = `
		position: absolute;
		bottom: 10px;
		left: 10px;
		font-family: monospace;
		white-space: pre;
		color: #ccc;
		pointer-events: none;
		visibility: hidden;
	`;
	document.body.appendChild( valuesEl );

	// renderer init
	renderer = new THREE.WebGPURenderer( { antialias: true } );
	await renderer.init();
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0x11161C );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setAnimationLoop( animation );
	document.body.appendChild( renderer.domElement );

	// init camera
	camera = new THREE.OrthographicCamera();
	camera.position.set( 0, 0, 1.5 );

	scene = new THREE.Scene();

	cameraCenter = new THREE.Vector2();

	// image plane
	plane = new THREE.Mesh(
		new THREE.PlaneGeometry(),
		new GraphMaterial( {
			side: THREE.DoubleSide,
			graphs,
		} )
	);
	plane.scale.setScalar( 2.0 );
	scene.add( plane );

	cameraCenter.set(
		- zoom * 0.5 + zoom * 0.05,
		getAspect() * zoom * 0.5 - zoom * 0.05,
	);

	const gui = new GUI();
	gui.add( plane.material, 'dim' );
	gui.add( params, 'aspect', 0.1, 2 );
	gui.add( params, 'reset' );

	const graphFolder = gui.addFolder( 'graphs' );
	plane.material.graphNames.forEach( ( name, i ) => {

		params.display[ i ] = true;
		graphFolder.add( params.display, i ).name( name );

	} );

	let clicked = false;
	let prevX = - 1;
	let prevY = - 1;
	renderer.domElement.addEventListener( 'pointerleave', () =>{

		dataContainerEl.style.visibility = 'hidden';
		valuesEl.style.visibility = 'hidden';

		// move the marker line and circles off screen
		plane.material.mousePoint.set( 1e10, 1e10 );

	} );

	renderer.domElement.addEventListener( 'pointerenter', () =>{

		dataContainerEl.style.visibility = 'visible';
		valuesEl.style.visibility = 'visible';

	} );

	renderer.domElement.addEventListener( 'pointerdown', e => {

		clicked = true;
		prevX = e.clientX;
		prevY = e.clientY;

	} );

	renderer.domElement.addEventListener( 'pointermove', e => {

		clicked = clicked && Boolean( e.buttons & 1 );
		if ( clicked ) {

			const deltaX = e.clientX - prevX;
			const deltaY = e.clientY - prevY;

			prevX = e.clientX;
			prevY = e.clientY;

			const xWidth = 1;
			const yWidth = getAspect();

			const graphDeltaX = zoom * xWidth * deltaX / window.innerWidth;
			const graphDeltaY = zoom * yWidth * deltaY / window.innerHeight;

			cameraCenter.x += graphDeltaX;
			cameraCenter.y += graphDeltaY;

		}

		dataContainerEl.style.left = `${ e.clientX }px`;
		dataContainerEl.style.top = `${ e.clientY }px`;

		const data = mouseToGraphValue( e.clientX, e.clientY );
		dataEl.innerText = `x: ${ data.x.toFixed( 3 ) }\ny: ${ data.y.toFixed( 3 ) }`;

		plane.material.mousePoint.set( data.x, data.y );

		updateGraphValues();

	} );

	renderer.domElement.addEventListener( 'wheel', e => {

		const mouseX = e.clientX;
		const mouseY = e.clientY;

		const xWidth = 1;
		const yWidth = getAspect();

		const centerRelX = ( mouseX / window.innerWidth ) - 0.5;
		const centerRelY = ( mouseY / window.innerHeight ) - 0.5;

		const graphX = zoom * xWidth * centerRelX;
		const graphY = zoom * yWidth * centerRelY;

		const beforeZoom = zoom;
		const delta = Math.pow( 0.95, 1.0 );

		if ( e.deltaY < 0 ) {

			zoom *= delta;

		} else {

			zoom /= delta;

		}

		zoom = Math.max( zoom, 0.1 );
		zoom = Math.min( zoom, 100 );

		const afterX = graphX * zoom / beforeZoom;
		const afterY = graphY * zoom / beforeZoom;

		cameraCenter.x -= graphX - afterX;
		cameraCenter.y -= graphY - afterY;

	} );

	window.addEventListener( 'resize', () => {

		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

}

// animation
function animation() {

	const mat = plane.material;
	const xWidth = 1;
	const yWidth = getAspect();

	mat.xRange.set(
		- cameraCenter.x - 0.5 * xWidth * zoom,
		- cameraCenter.x + 0.5 * xWidth * zoom,
	);

	mat.yRange.set(
		cameraCenter.y - 0.5 * yWidth * zoom,
		cameraCenter.y + 0.5 * yWidth * zoom,
	);

	params.display.forEach( ( visible, i ) => {

		mat.setGraphVisible( i, visible );

	} );

	renderer.render( scene, camera );

}

function getAspect() {

	return params.aspect * window.innerHeight / window.innerWidth;

}

// evaluates the graphs at the cursor x on the gpu and displays the results
async function updateGraphValues() {

	if ( readingValues ) {

		return;

	}

	readingValues = true;

	const x = plane.material.mousePoint.x;
	const values = await plane.material.readGraphValues( renderer );

	readingValues = false;

	const graphNames = plane.material.graphNames;
	const lines = [ `x: ${ x.toFixed( 3 ) }` ];
	values.forEach( ( v, i ) => {

		lines.push( `<span style="color:${ plane.material.getGraphColor( i ).getStyle() }">${ graphNames[ i ] }: ${ v.toFixed( 5 ) }</span>` );

	} );

	valuesEl.innerHTML = lines.join( '\n' );

}

function mouseToGraphValue( x, y ) {

	const xWidth = 1;
	const yWidth = getAspect();

	const centerRelX = ( x / window.innerWidth ) - 0.5;
	const centerRelY = ( y / window.innerHeight ) - 0.5;

	const graphX = zoom * xWidth * centerRelX - cameraCenter.x;
	const graphY = zoom * yWidth * centerRelY - cameraCenter.y;

	return { x: graphX, y: - graphY };

}
