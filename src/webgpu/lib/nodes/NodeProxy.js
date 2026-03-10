import { FunctionCallNode } from 'three/webgpu';

export class NodeProxy {

	get isNode() {

		return true;

	}

	// getter for the node being proxied to
	get proxyNode() {

		const { proxyObject, proxyProperty } = this;
		const properties = proxyProperty.split( '.' );
		let value = proxyObject;
		for ( let i = 0, l = properties.length; i < l; i ++ ) {

			value = value[ properties[ i ] ];

		}

		if ( 'functionNode' in value ) {

			return value.functionNode;

		} else {

			return value;

		}

	}

	constructor( property, object = null ) {

		// store the proxy property and objects so they can be changed later
		this.proxyObject = object;
		this.proxyProperty = property;

		// set up a proxy to redirect all calls to the proxied node in order to avoid replicating
		// expected members for all node types.
		return new Proxy( this, {

			get( target, property ) {

				if ( property in target ) {

					return Reflect.get( target, property );

				} else {

					const value = Reflect.get( target.proxyNode, property );
					if ( typeof value === 'function' ) {

						return value.bind( target.proxyNode );

					} else {

						return value;

					}

				}

			},

			set( target, property, value ) {

				if ( property in target ) {

					return Reflect.set( target, property, value );

				} else {

					throw new Error( 'NodeProxy: Cannot set members of proxied nodes.' );

				}

			},

		} );

	}

}

export const proxy = ( ...args ) => {

	return new NodeProxy( ...args );

};

export const proxyFn = ( ...args ) => {

	const nodeProxy = new NodeProxy( ...args );
	const fn = ( ...params ) => {

		// match FunctionCallNode.call() convention
		const parameters = params.length === 1 && params[ 0 ] && typeof params[ 0 ] === 'object' && ! params[ 0 ].isNode
			? params[ 0 ]
			: params;
		return new FunctionCallNode( nodeProxy, parameters );

	};

	fn.functionNode = nodeProxy;
	return fn;

};
