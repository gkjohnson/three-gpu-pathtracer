import { CodeNode } from 'three/webgpu';

// a more structured "struct" node that bookkeeps the struct name, byte size
export class WGSLStructNode extends CodeNode {

	get uintSize() {

		return this.byteSize / 4;

	}

	constructor( name, byteSize, fields, includes = [] ) {

		const content = Object
			.entries( fields )
			.map( ( [ name, type ] ) => {

				return `${ name }: ${ type },`;

			} ).join( '\n' );

		const code = /* wgsl */`
			struct ${ name } {
				${ content }
			}
		`;

		super( code, includes, 'wgsl' );
		this.name = name;
		this.byteSize = byteSize;
		this.fields = fields;

	}

}

export const wgslStruct = ( ...args ) => new WGSLStructNode( ...args );
