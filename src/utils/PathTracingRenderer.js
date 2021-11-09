import { RGBAFormat, FloatType, Color } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

function* renderTask() {

    const tw = this.tiles.x;
    const ty = this.tiles.y;
    while ( true ) {

        // TODO: jitter camera

        for ( let x = 0; x < tw; x ++ ) {

            for ( let y = 0; y < ty; y ++ ) {

                // TODO: set camera offset

                // TODO: render

                // TODO: handle checker case?

            }

        }

    }

}

const ogClearColor = new Color();
export class PathTracingRenderer {

    get material() {

        return this._fsQuad.material;

    }

    set material( v ) {

        this._fsQuad.material = v;

    }

    constructor( renderer ) {

        this.tiles = new Vector2();
        this.target = new WebGLRenderTarget( 1, 1, {
            format: RGBAFormat,
            type: FloatType,
        } );
        this._renderer = renderer;
        this._fsQuad = new FullScreenQuad( null );
        this._task = null;

    }

    setSize( w, h ) {

        this.target.setSize( w, h );
        this.reset();

    }

    reset() {

        const renderer = this._renderer;
        const target = this.target;
        const ogRenderTarget = renderer.getRenderTarget();
        const ogClearAlpha = renderer.getClearAlpha();
        renderer.getClearColor( ogClearColor );

        renderer.setRenderTarget( target );
        renderer.setClearColor( 0, 0 );
        renderer.clearColor();

        renderer.setClearColor( ogClearColor, ogClearAlpha );
        renderer.setRenderTarget( ogRenderTarget );

    }

    update() {

        if ( ! this._task ) {

            this._task = renderTask.call( this );

        }

        this._task.next();

    }

}
