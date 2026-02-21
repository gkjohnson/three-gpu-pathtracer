import { StructTypeNode } from 'three/webgpu';

// a more structured "struct" node that bookkeeps the struct name, byte size
export class WGSLStructNode extends StructTypeNode {

	constructor( name, fields ) {

		super( fields );
		this.name = name;
		this.fields = fields;

	}

}

export const wgslStruct = ( ...args ) => new WGSLStructNode( ...args );
