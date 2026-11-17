/** @import { ReactNode } from 'react' */
import { createContext, createElement, forwardRef, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Matrix4 } from 'three';
import { WebGPUPathTracer as WebGPUPathTracerImpl } from '../../webgpu/WebGPUPathTracer.js';
import { useShallowOptions } from '../utilities/useOptions.js';
import { useObjectDep } from '../utilities/useObjectDep.js';
import { useApplyRefs } from '../utilities/useApplyRefs.js';

// contexts for accessing the path tracer and its attached denoiser and upscaler
export const WebGPUPathTracerContext = createContext( null );
export const DenoiserContext = createContext( null );
export const UpscalerContext = createContext( null );

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

				cameraState.matrixWorld.copy( camera.matrixWorld );
				cameraState.projectionMatrix.copy( camera.projectionMatrix );
				pathTracer.updateCamera();

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

// creates an instance of "type" from "args", an object (single arg) or array (spread as multiple args)
function useInstance( type, args, pathTracer ) {

	const [ instance, setInstance ] = useState( null );

	useLayoutEffect( () => {

		if ( pathTracer === null ) {

			return;

		}

		const instance = Array.isArray( args ) ? new type( ...args ) : new type( args );
		setInstance( instance );

		return () => {

			instance.dispose();
			setInstance( null );

		};

	}, [ type, pathTracer, useObjectDep( args ) ] ); // eslint-disable-line

	return instance;

}

/**
 * Attaches a denoiser to the nearest parent WebGPUPathTracer. Must be a child of WebGPUPathTracer.
 * All properties on the denoiser instance can be set as props directly.
 * @component
 * @param {Object} props
 * @param {Function} props.denoiser - The denoiser class to instantiate, such as `OIDNDenoiser`.
 * @param {Object|Array} [props.args] - Constructor arguments: an object (single arg) or array (spread as multiple args).
 * The denoiser is re-instantiated whenever the values of `args` change (a shallow comparison).
 * @param {ReactNode} [props.children] - Children rendered once the denoiser is attached.
 */
export const Denoiser = forwardRef( function Denoiser( props, ref ) {

	const { denoiser, args, children, ...options } = props;
	const pathTracer = useContext( WebGPUPathTracerContext );
	const instance = useInstance( denoiser, args, pathTracer );

	// assigns any provided options to the denoiser
	useShallowOptions( instance, options );

	// attach the denoiser
	useLayoutEffect( () => {

		if ( instance === null ) {

			return;

		}

		pathTracer.setDenoiser( instance );
		return () => {

			pathTracer.setDenoiser( null );

		};

	}, [ instance ] ); // eslint-disable-line

	// assign ref
	useApplyRefs( instance, ref );

	if ( ! instance ) {

		return null;

	}

	return createElement( DenoiserContext.Provider, { value: instance }, children );

} );

/**
 * Attaches an upscaler to the nearest parent WebGPUPathTracer. Must be a child of WebGPUPathTracer.
 * All properties on the upscaler instance can be set as props directly.
 * @component
 * @param {Object} props
 * @param {Function} props.upscaler - The upscaler class to instantiate, such as `FSRUpscaler`.
 * @param {Object|Array} [props.args] - Constructor arguments: an object (single arg) or array (spread as multiple args).
 * The upscaler is re-instantiated whenever the values of `args` change (a shallow comparison).
 * @param {ReactNode} [props.children] - Children rendered once the upscaler is attached.
 */
export const Upscaler = forwardRef( function Upscaler( props, ref ) {

	const { upscaler, args, children, ...options } = props;
	const pathTracer = useContext( WebGPUPathTracerContext );
	const instance = useInstance( upscaler, args, pathTracer );

	// assigns any provided options to the upscaler
	useShallowOptions( instance, options );

	// attach the upscaler
	useLayoutEffect( () => {

		if ( instance === null ) {

			return;

		}

		pathTracer.setUpscaler( instance );
		return () => {

			pathTracer.setUpscaler( null );

		};

	}, [ instance ] ); // eslint-disable-line

	// assign ref
	useApplyRefs( instance, ref );

	if ( ! instance ) {

		return null;

	}

	return createElement( UpscalerContext.Provider, { value: instance }, children );

} );
