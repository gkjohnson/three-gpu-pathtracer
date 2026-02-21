import { Node } from 'three/webgpu';

export class NodeProxy extends Node {

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

	getNodeType( builder ) {

		return this.node.getNodeType( builder );

	}

	setup( builder ) {

		return this.node;

	}

}

export const proxy = ( ...args ) => new NodeProxy( ...args );
