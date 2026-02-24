import { Node } from 'three/webgpu';

class ProxyCallNode extends Node {

	static get type() {

		return 'ProxyCallNode';

	}

	constructor( proxyNode, params ) {

		super();
		this.proxyNode = proxyNode;
		this.params = params;

	}

	setup() {

		return this.proxyNode.node.call( ...this.params );

	}

}

export class NodeProxy extends Node {

	static get type() {

		return 'NodeProxy';

	}

	get node() {

		const { properties, object } = this;
		let value = object;
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

		super();
		this.object = object;
		this.property = property;
		this.properties = property.split( '.' );

	}

	// delegate type resolution to the target node
	getNodeType( builder ) {

		return this.node.getNodeType( builder );

	}

	// include the target node's cache key so the proxy invalidates when the target changes
	customCacheKey() {

		return this.node.getCacheKey();

	}

	// return the target node as the output so the builder uses it for analyze/generate
	setup( builder ) {

		return this.node;

	}

}

export const proxy = ( ...args ) => {

	const nodeProxy = new NodeProxy( ...args );
	const fn = ( ...params ) => new ProxyCallNode( nodeProxy, params );
	fn.functionNode = nodeProxy;
	return fn;

};
