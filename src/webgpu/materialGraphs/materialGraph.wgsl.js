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
	const cases = graphs.map( ( { material, outputs }, index ) => {

		const assignments = outputs.map( ( { field, type, node } ) => {

			const graphFn = getMaterialGraphFn( `materialGraph${ index }_${ field }`, material, node, type );
			return wgslTagCode/* wgsl */`surf.${ field } = ${ graphFn }( hit, vertexData, objectInfo, view, surf.normal );`;

		} );

		return wgslTagCode/* wgsl */`
			case ${ index }: {

				${ joinCode( assignments ) }

			}
		`;

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

				${ joinCode( cases ) }
				default: {}

			}

		}
	`;

}

// joins "wgslTagCode" snippets into one
function joinCode( codes ) {

	return wgslTagCode( [ '', ...codes.map( () => '\n' ) ], ...codes );

}
