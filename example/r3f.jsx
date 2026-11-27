import { StrictMode, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Backdrop, Center, Environment, OrbitControls, Resize, useGLTF } from '@react-three/drei';
import { WebGPURenderer } from 'three/webgpu';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { initUNetFromURL } from 'oidn-webgpu';
import { Upscaler as UpscalerImpl } from '@pmndrs/upscaler';
import { OIDNDenoiser, FSRUpscaler } from 'three-gpu-pathtracer/webgpu';
import { WebGPUPathTracer, Denoiser, Upscaler, usePathTracer } from 'three-gpu-pathtracer/r3f';
import { getScaledSettings } from './src/getScaledSettings.js';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/studio_small_05_1k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/devices/headphone-with-stand.glb';

// the library ships neither "oidn-webgpu" nor the network weights, so the app provides both. The instances
// are kept for the page's lifetime so toggling them doesn't reload the weights
const denoiser = new OIDNDenoiser( {
	initUNetFromURL,
	auxWeightsUrl: new URL( './src/denoise/rt_hdr_alb_nrm.tza', import.meta.url ).toString(),
} );
const upscaler = new FSRUpscaler( { Upscaler: UpscalerImpl } );

// sets the worker class the path tracer from context builds the scene's BVHs with, so loading doesn't block
// the page. React runs a child's layout effects before its parent's, so this is set before the first "setScene"
function BVHWorker( { worker } ) {

	const pathTracer = usePathTracer();
	useLayoutEffect( () => {

		if ( pathTracer === null ) {

			return;

		}

		pathTracer.setBVHWorker( worker );
		return () => {

			pathTracer.setBVHWorker( null );

		};

	}, [ pathTracer, worker ] );

	return null;

}

// Model by "Halil Kantarci" on Sketchfab, scaled to 2 units and stood on the floor
function Headphones() {

	const { scene } = useGLTF( MODEL_URL );
	return <Center top>
		<Resize scale={ 2 }>
			<primitive object={ scene } />
		</Resize>
	</Center>;

}

// the path tracer does not watch the scene, so a material edit is followed by a call to
// "updateMaterials" on the instance from context
function StudioBackdrop( { color } ) {

	const pathTracer = usePathTracer();
	const material = useRef();

	useEffect( () => {

		material.current.color.set( color );
		pathTracer?.updateMaterials();

	}, [ pathTracer, color ] );

	return <Backdrop floor={ 1.5 } segments={ 32 } scale={ [ 12, 5, 4 ] } position={ [ 0, 0, - 1.5 ] }>
		<meshPhysicalMaterial ref={ material } roughness={ 0.6 } />
	</Backdrop>;

}

function App() {

	const [ params, setParams ] = useState( {
		enabled: true,
		maxSamples: 16,
		denoise: true,
		upscale: true,
		sharpness: 1,
		color: '#3366aa',
		...getScaledSettings(),
	} );

	useEffect( () => {

		const gui = new GUI();
		const state = { ...params };
		const update = () => setParams( { ...state } );
		const pathTracingFolder = gui.addFolder( 'Path Tracer' );
		pathTracingFolder.add( state, 'enabled' ).onChange( update );
		pathTracingFolder.add( state, 'renderScale', 0.1, 1, 0.01 ).onChange( update );
		pathTracingFolder.add( state, 'maxSamples', 1, 100, 1 ).onChange( update );

		const postFolder = gui.addFolder( 'Denoise / Upscale' );
		postFolder.add( state, 'denoise' ).onChange( update );
		postFolder.add( state, 'upscale' ).onChange( update );
		postFolder.add( state, 'sharpness', 0, 1, 0.01 ).onChange( update );

		const backdropFolder = gui.addFolder( 'Backdrop' );
		backdropFolder.addColor( state, 'color' ).onChange( update );
		return () => gui.destroy();

	}, [] ); // eslint-disable-line

	return (
		<Canvas
			camera={ { position: [ 3, 2.5, 5 ], fov: 40 } }
			gl={ async props => {

				const renderer = new WebGPURenderer( { ...props, trackTimestamp: true } );
				await renderer.init();
				return renderer;

			} }
		>
			<Suspense fallback={ null }>
				<WebGPUPathTracer
					enabled={ params.enabled }
					maxSamples={ params.maxSamples }
					renderScale={ params.renderScale }
					frameBudget={ params.frameBudget }
				>
					<BVHWorker worker={ GenerateMeshBVHWorker } />
					{ params.denoise && <Denoiser denoiser={ denoiser } /> }
					{ params.upscale && <Upscaler upscaler={ upscaler } sharpness={ params.sharpness } /> }
					<Headphones />
					<StudioBackdrop color={ params.color } />
					<Environment files={ ENV_URL } background={ true } />
					<OrbitControls makeDefault enableDamping={ false } target={ [ 0, 0.8, 0 ] } />
				</WebGPUPathTracer>
			</Suspense>
		</Canvas>
	);

}

createRoot( document.getElementById( 'root' ) ).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
