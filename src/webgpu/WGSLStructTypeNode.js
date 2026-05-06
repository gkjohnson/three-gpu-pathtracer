import { StructTypeNode } from 'three/webgpu';

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

	setup( builder ) {
		// No-op: struct is defined in WGSL, not auto-generated
	}

	generateNodeType( builder ) {

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
