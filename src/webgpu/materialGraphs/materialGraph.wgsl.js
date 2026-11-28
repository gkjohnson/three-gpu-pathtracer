import { wgslTagFn, wgslTagCode, contextProxy } from 'three-mesh-bvh/webgpu';
import { hitRecordStruct } from '../nodes/structs.wgsl.js';
import { getMaterialGraphFn } from './MaterialGraphBuilder.js';

const attributesStruct = /* @__PURE__ */ contextProxy( 'bvhData.structs.attributes' );
const surfaceRecordStruct = /* @__PURE__ */ contextProxy( 'shadingModel.structs.surfaceRecord' );
const objectsStorage = /* @__PURE__ */ contextProxy( 'bvhData.storage.objects' );
const materialsStorage = /* @__PURE__ */ contextProxy( 'shadingModel.storage.materials' );

// Returns the function running the graphs of the hit's material, writing their outputs to "surf"
// TODO: see if the inputs can be passed as pointers, which needs "getSurfaceRecord" to take pointers too
// TODO: pass the ray state, like the pixel and bounce, for graphs that read them. May just be the ray input
export function getEvaluateMaterialGraphFn( graphs ) {

	// a switch case per material, setting each field it has a graph for
	const cases = [];
	graphs.forEach( ( { material, outputs }, index ) => {

		cases.push( `case ${ index }: {\n` );
		outputs.forEach( ( { field, type, node } ) => {

			const graphFn = getMaterialGraphFn( `materialGraph${ index }_${ field }`, material, node, type );
			cases.push( `surf.${ field } = `, graphFn, '( hit, vertexData, objectInfo, view, surf.normal );\n' );

		} );
		cases.push( '}\n' );

	} );

	return wgslTagFn/* wgsl */`
		fn evaluateMaterialGraph(
			hit: ${ hitRecordStruct },
			vertexData: ${ attributesStruct },
			view: vec3f,
			surf: ptr<function, ${ surfaceRecordStruct }>,
		) -> void {

			let objectInfo = ${ objectsStorage }[ hit.objectIndex ];
			switch ( ${ materialsStorage }[ objectInfo.materialIndex ].graphIndex ) {

				${ joinTagCode( cases ) }
				default: {}

			}

		}
	`;

}

// joins strings and nodes into a "wgslTagCode"
function joinTagCode( parts ) {

	const tokens = [ '' ];
	const args = [];
	parts.forEach( part => {

		if ( typeof part === 'string' ) {

			tokens[ tokens.length - 1 ] += part;

		} else {

			args.push( part );
			tokens.push( '' );

		}

	} );

	return wgslTagCode( tokens, ...args );

}
