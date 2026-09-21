import { StrictMode, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { WebGPURenderer } from 'three/webgpu';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { WebGPUPathTracer, usePathTracer } from 'three-gpu-pathtracer/r3f';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/studio_small_05_1k.hdr';

// the path tracer does not watch the scene, so a material edit is followed by a call to
// "updateMaterials" on the instance from context
function Spheres( { color } ) {

	const pathTracer = usePathTracer();
	const material = useRef();

	useEffect( () => {

		material.current.color.set( color );
		pathTracer?.updateMaterials();

	}, [ pathTracer, color ] );

	return <>
		<mesh position={ [ - 1.5, 0.6, 0 ] }>
			<sphereGeometry args={ [ 0.6, 64, 32 ] } />
			<meshPhysicalMaterial ref={ material } roughness={ 0.15 } />
		</mesh>
		<mesh position={ [ 0, 0.6, 0 ] }>
			<sphereGeometry args={ [ 0.6, 64, 32 ] } />
			<meshPhysicalMaterial color="#ffffff" roughness={ 0.05 } metalness={ 1 } />
		</mesh>
		<mesh position={ [ 1.5, 0.6, 0 ] }>
			<sphereGeometry args={ [ 0.6, 64, 32 ] } />
			<meshPhysicalMaterial color="#ffffff" roughness={ 0.02 } transmission={ 1 } thickness={ 1.2 } ior={ 1.5 } />
		</mesh>
		<mesh rotation-x={ - Math.PI / 2 }>
			<planeGeometry args={ [ 20, 20 ] } />
			<meshPhysicalMaterial color="#cfcfd4" roughness={ 0.6 } />
		</mesh>
	</>;

}

function App() {

	const [ params, setParams ] = useState( {
		enabled: true,
		maxBounces: 5,
		renderScale: 1,
		color: '#e0493e',
	} );

	useEffect( () => {

		const gui = new GUI();
		const state = { ...params };
		const update = () => setParams( { ...state } );
		gui.add( state, 'enabled' ).onChange( update );
		gui.add( state, 'maxBounces', 1, 20, 1 ).onChange( update );
		gui.add( state, 'renderScale', 0.1, 1, 0.01 ).onChange( update );
		gui.addColor( state, 'color' ).onChange( update );
		return () => gui.destroy();

	}, [] ); // eslint-disable-line

	return (
		<Canvas
			camera={ { position: [ 3, 2.5, 5 ], fov: 40 } }
			gl={ async props => {

				const renderer = new WebGPURenderer( props );
				await renderer.init();
				return renderer;

			} }
		>
			<Suspense fallback={ null }>
				<WebGPUPathTracer
					enabled={ params.enabled }
					maxBounces={ params.maxBounces }
					renderScale={ params.renderScale }
				>
					<Spheres color={ params.color } />
					<Environment files={ ENV_URL } background={ true } />
					<OrbitControls makeDefault target={ [ 0, 0.5, 0 ] } />
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
