import { proxy } from 'three-mesh-bvh/webgpu';

// A container whose members are returned as stable proxy nodes. Assigning a member stores the underlying node.
// "createProxy" selects the proxy variant - "proxy" for plain nodes, "proxyFn" for callable function nodes.
// TODO: a copy of three-mesh-bvh's BVHComputeData container, import it from there once it's exported
export class NodeProxyObject {

	constructor( initialization = {}, createProxy = proxy ) {

		const proxies = {};
		return new Proxy( { ...initialization }, {

			get( target, property ) {

				if ( ! proxies[ property ] ) {

					proxies[ property ] = createProxy( property, target );

				}

				return proxies[ property ];

			},

			set( target, property, value ) {

				target[ property ] = value;
				return true;

			},

		} );

	}

}
