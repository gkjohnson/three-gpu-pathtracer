/** @import { ReactNode } from 'react' */
import { createContext, createElement, forwardRef, useContext, useLayoutEffect } from 'react';
import { WebGPUPathTracerContext } from './WebGPUPathTracer.js';
import { useShallowOptions } from '../utilities/useOptions.js';
import { useApplyRefs } from '../utilities/useApplyRefs.js';
import { useInstance } from '../utilities/useInstance.js';

// context for accessing the attached denoiser
export const DenoiserContext = createContext( null );

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
