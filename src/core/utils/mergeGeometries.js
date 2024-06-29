import { BufferAttribute, BufferGeometry } from 'three';
import { copyAttributeContents, createAttributeClone } from './BufferAttributeUtils.js';

function validateMergeability( geometries ) {

	const isIndexed = geometries[ 0 ].index !== null;
	const attributesUsed = new Set( Object.keys( geometries[ 0 ].attributes ) );
	if ( ! geometries[ 0 ].getAttribute( 'position' ) ) {

		throw new Error( 'StaticGeometryGenerator: position attribute is required.' );

	}

	for ( let i = 0; i < geometries.length; ++ i ) {

		const geometry = geometries[ i ];
		let attributesCount = 0;

		// ensure that all geometries are indexed, or none
		if ( isIndexed !== ( geometry.index !== null ) ) {

			throw new Error( 'StaticGeometryGenerator: All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.' );

		}

		// gather attributes, exit early if they're different
		for ( const name in geometry.attributes ) {

			if ( ! attributesUsed.has( name ) ) {

				throw new Error( 'StaticGeometryGenerator: All geometries must have compatible attributes; make sure "' + name + '" attribute exists among all geometries, or in none of them.' );

			}

			attributesCount ++;

		}

		// ensure geometries have the same number of attributes
		if ( attributesCount !== attributesUsed.size ) {

			throw new Error( 'StaticGeometryGenerator: All geometries must have the same number of attributes.' );

		}

	}

}

function getTotalIndexCount( geometries ) {

	let result = 0;
	for ( let i = 0, l = geometries.length; i < l; i ++ ) {

		result += geometries[ i ].getIndex().count;

	}

	return result;

}

function getTotalAttributeCount( geometries ) {

	let result = 0;
	for ( let i = 0, l = geometries.length; i < l; i ++ ) {

		result += geometries[ i ].getAttribute( 'position' ).count;

	}

	return result;

}

function trimMismatchedAttributes( target, indexCount, attrCount ) {

	if ( target.index && target.index.count !== indexCount ) {

		target.setIndex( null );

	}

	const attributes = target.attributes;
	for ( const key in attributes ) {

		const attr = attributes[ key ];
		if ( attr.count !== attrCount ) {

			target.deleteAttribute( key );

		}

	}

}

// Modified version of BufferGeometryUtils.mergeBufferGeometries that ignores morph targets and updates a attributes in place
export function mergeGeometries( geometries, options = {}, targetGeometry = new BufferGeometry() ) {

	const {
		useGroups = false,
		forceUpdate = false,
		skipAssigningAttributes = [],
		overwriteIndex = true,
	} = options;

	// check if we can merge these geometries
	validateMergeability( geometries );

	const isIndexed = geometries[ 0 ].index !== null;
	const totalIndexCount = isIndexed ? getTotalIndexCount( geometries ) : - 1;
	const totalAttributeCount = getTotalAttributeCount( geometries );
	trimMismatchedAttributes( targetGeometry, totalIndexCount, totalAttributeCount );

	// set up groups
	if ( useGroups ) {

		let offset = 0;
		for ( let i = 0, l = geometries.length; i < l; i ++ ) {

			const geometry = geometries[ i ];

			let primitiveCount;
			if ( isIndexed ) {

				primitiveCount = geometry.getIndex().count;

			} else {

				primitiveCount = geometry.getAttribute( 'position' ).count;

			}

			targetGeometry.addGroup( offset, primitiveCount, i );
			offset += primitiveCount;

		}

	}

	// generate the final geometry
	// skip the assigning any attributes for items in the above array
	if ( isIndexed ) {

		// set up the index if it doesn't exist
		let forceUpdateIndex = false;
		if ( ! targetGeometry.index ) {

			targetGeometry.setIndex( new BufferAttribute( new Uint32Array( totalIndexCount ), 1, false ) );
			forceUpdateIndex = true;

		}

		if ( forceUpdateIndex || overwriteIndex ) {

			// copy the index data to the target geometry
			let targetOffset = 0;
			let indexOffset = 0;
			const targetIndex = targetGeometry.getIndex();
			for ( let i = 0, l = geometries.length; i < l; i ++ ) {

				const geometry = geometries[ i ];
				const index = geometry.getIndex();
				const skip = ! forceUpdate && ! forceUpdateIndex && skipAssigningAttributes[ i ];
				if ( ! skip ) {

					for ( let j = 0; j < index.count; ++ j ) {

						targetIndex.setX( targetOffset + j, index.getX( j ) + indexOffset );

					}

				}

				targetOffset += index.count;
				indexOffset += geometry.getAttribute( 'position' ).count;

			}

		}

	}

	// copy all the attribute data over
	const attributes = Object.keys( geometries[ 0 ].attributes );
	for ( let i = 0, l = attributes.length; i < l; i ++ ) {

		let forceUpdateAttr = false;
		const key = attributes[ i ];
		if ( ! targetGeometry.getAttribute( key ) ) {

			const firstAttr = geometries[ 0 ].getAttribute( key );
			targetGeometry.setAttribute( key, createAttributeClone( firstAttr, totalAttributeCount ) );
			forceUpdateAttr = true;

		}

		let offset = 0;
		const targetAttribute = targetGeometry.getAttribute( key );
		for ( let g = 0, l = geometries.length; g < l; g ++ ) {

			const geometry = geometries[ g ];
			const skip = ! forceUpdate && ! forceUpdateAttr && skipAssigningAttributes[ g ];
			const attr = geometry.getAttribute( key );
 			if ( ! skip ) {

				if ( key === 'color' && targetAttribute.itemSize !== attr.itemSize ) {

					// make sure the color attribute is aligned with itemSize 3 to 4
					for ( let index = offset, l = attr.count; index < l; index ++ ) {

						attr.setXYZW( index, targetAttribute.getX( index ), targetAttribute.getY( index ), targetAttribute.getZ( index ), 1.0 );

					}

				} else {

					copyAttributeContents( attr, targetAttribute, offset );

				}

			}

			offset += attr.count;

		}

	}

}
