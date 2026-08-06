import { StructTypeNode } from 'three/webgpu';

// A StructTypeNode whose layout is defined by hand-written WGSL rather than auto-generated from a
// field map. This lets a struct carry a trailing runtime-sized `array< T >` member ( which the TSL
// struct builder can't express ), so queue metadata ( start / end cursors ) can live in the same
// storage buffer as the queue elements — removing the need for a separate queueSizes buffer.
class WGSLStructTypeNode extends StructTypeNode {

	constructor( name, structCodeNode = null ) {

		super( {}, name );
		this.isWGSLStructTypeNode = true;
		this.structCodeNode = structCodeNode;

	}

	addInclude( node ) {

		this.includes.push( node );
		return this;

	}

	setup( /* builder */ ) {

		// no-op: the struct is defined in WGSL, not auto-generated

	}

	generateNodeType( /* builder */ ) {

		return this.name;

	}

	generate( builder ) {

		if ( this.structCodeNode ) {

			this.structCodeNode.build( builder );

		}

		return this.name;

	}

}

export { WGSLStructTypeNode };
