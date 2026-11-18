/** @import { ReactNode } from 'react' */
import { createContext, createElement, forwardRef, useContext, useLayoutEffect } from 'react';
import { WebGPUPathTracerContext } from './WebGPUPathTracer.js';
import { useShallowOptions } from '../utilities/useOptions.js';
import { useApplyRefs } from '../utilities/useApplyRefs.js';
import { useInstance } from '../utilities/useInstance.js';

// context for accessing the attached upscaler
export const UpscalerContext = createContext( null );

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
