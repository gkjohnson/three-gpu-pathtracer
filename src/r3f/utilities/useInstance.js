import { useLayoutEffect, useState } from 'react';
import { useObjectDep } from './useObjectDep.js';

// creates an instance of "type" from "args", an object (single arg) or array (spread as multiple args)
export function useInstance( type, args, pathTracer ) {

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
