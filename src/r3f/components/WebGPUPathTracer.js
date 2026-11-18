/** @import { ReactNode } from 'react' */
import { createContext, createElement, forwardRef, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Matrix4 } from 'three';
import { WebGPUPathTracer as WebGPUPathTracerImpl } from '../../webgpu/WebGPUPathTracer.js';
import { useShallowOptions } from '../utilities/useOptions.js';
import { useApplyRefs } from '../utilities/useApplyRefs.js';

// context for accessing the path tracer
export const WebGPUPathTracerContext = createContext( null );

/**
 * Returns the nearest parent WebGPUPathTracer instance, or null if there is none. Use it to
 * notify the path tracer of scene changes with `setScene`, `updateMaterials`, `updateTransforms`,
 * `updateLights`, `updateEnvironment`, or `reset`.
 * @returns {WebGPUPathTracerImpl|null}
 */
export function usePathTracer() {

	return useContext( WebGPUPathTracerContext );

}

/**
 * Wrapper for the WebGPUPathTracer class that renders the fiber scene and camera. The settable
 * properties of the path tracer instance, such as `maxBounces`, `maxSamples` or `renderScale`, can
 * be set as props, and its events registered with `onComplete` and `onProgress`. Camera changes
 * restart the render automatically. Scene changes are not tracked: call the update functions on
 * the instance from `usePathTracer` after adding, moving, or restyling objects.
 * @component
 * @param {Object} props
 * @param {boolean} [props.enabled=true] - If false, the scene is rasterized normally instead.
 * @param {number} [props.renderPriority=1] - Priority of the frame callback used to render.
 * @param {ReactNode} [props.children] - Children rendered with access to the path tracer context.
 */
export const WebGPUPathTracer = forwardRef( function WebGPUPathTracer( props, ref ) {

	const { enabled = true, renderPriority = 1, children, ...options } = props;
	const [ gl, scene, camera ] = useThree( state => [ state.gl, state.scene, state.camera ] );
	const [ pathTracer, setPathTracer ] = useState( null );
	const [ cameraState ] = useState( () => ( { matrixWorld: new Matrix4(), projectionMatrix: new Matrix4() } ) );

	// create the path tracer
	useEffect( () => {

		const pathTracer = new WebGPUPathTracerImpl( gl );
		setPathTracer( pathTracer );

		return () => {

			pathTracer.dispose();
			setPathTracer( null );

		};

	}, [ gl ] );

	// set the scene and camera
	useLayoutEffect( () => {

		if ( pathTracer === null ) {

			return;

		}

		pathTracer.setScene( scene, camera );

	}, [ pathTracer, scene, camera ] );

	// render a sample, or fall back to rasterizing the scene. A positive priority takes over
	// rendering from fiber so both cases have to draw.
	useFrame( state => {

		if ( pathTracer !== null && enabled ) {

			// restart the render when the camera moved or its projection changed, such as on resize
			const { camera } = state;
			camera.updateMatrixWorld();
			if ( ! cameraState.matrixWorld.equals( camera.matrixWorld ) || ! cameraState.projectionMatrix.equals( camera.projectionMatrix ) ) {

				// stored after the update, which rebuilds the projection for the WebGPU coordinate system
				pathTracer.updateCamera();
				cameraState.matrixWorld.copy( camera.matrixWorld );
				cameraState.projectionMatrix.copy( camera.projectionMatrix );

			}

			pathTracer.renderSample();

		} else {

			state.gl.render( state.scene, state.camera );

		}

	}, renderPriority );

	// assign ref
	useApplyRefs( pathTracer, ref );

	// assign the settable properties and events
	useShallowOptions( pathTracer, options );

	return createElement( WebGPUPathTracerContext.Provider, { value: pathTracer }, children );

} );
