import { StructTypeNode } from 'three/webgpu';

// StructTypeNode that force-emits dependency structs. TSL can't discover a struct referenced only via
// a type string, so we build each dependency first, which registers its definition ahead of this struct.
// TODO: remove this once TSL resolves struct dependencies from string member types itself.
export class DependentStructTypeNode extends StructTypeNode {

	constructor( members, name, dependencies = [] ) {

		super( members, name );
		this.dependencies = dependencies;

	}

	setup( builder ) {

		for ( const dep of this.dependencies ) {

			dep.build( builder );

		}

		super.setup( builder );

	}

}
