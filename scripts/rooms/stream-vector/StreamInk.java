import java.awt.Shape;
import java.awt.geom.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.zip.*;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.*;
import org.apache.pdfbox.contentstream.PDFGraphicsStreamEngine;
import org.apache.pdfbox.contentstream.operator.Operator;
import org.apache.pdfbox.io.RandomAccessReadBufferedFile;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.*;
import org.apache.pdfbox.pdmodel.graphics.color.PDColor;
import org.apache.pdfbox.pdmodel.graphics.form.*;
import org.apache.pdfbox.pdmodel.graphics.image.PDImage;
import org.apache.pdfbox.pdmodel.graphics.state.*;
import org.apache.pdfbox.util.Matrix;
import org.apache.pdfbox.util.Vector;

/** Compact interpreted-paint evidence. No room labels, inference or production mutation. */
public final class StreamInk extends PDFGraphicsStreamEngine {
    static final String VERSION = "pdfbox-stream-ink-v1";
    static final long MAX_OPERATORS = 8_000_000, MAX_COMMANDS = 8_000_000, MAX_EVENTS = 2_000_000;
    static final int MAX_PATH_COMMANDS = 100_000, MAX_STATES = 100_000, MAX_CLIPS = 20_000;
    final Spool spool;
    final AffineTransform viewport;
    final double userUnit, width, height;
    Path2D.Double path = new Path2D.Double();
    List<Long> commandOperators = new ArrayList<>();
    final Map<String,Integer> states = new HashMap<>(), clips = new HashMap<>();
    final IdentityHashMap<Area,Integer> clipCache = new IdentityHashMap<>();
    final Deque<Boolean> marked = new ArrayDeque<>();
    final Map<String,Long> operatorCounts = new TreeMap<>(), unsupported = new TreeMap<>();
    long operators, currentOperator, commands, events, paths, glyphs, unknownGlyphs, images, emptyPaths;
    int pendingClip = -1, formDepth, groupDepth, optionalDepth, glyphDepth;
    boolean pathMixedTransform;
    String pathTransform;

    StreamInk(PDPage page, Spool spool) throws IOException {
        super(page); this.spool = spool;
        PDRectangle b = page.getCropBox(); userUnit = page.getUserUnit();
        if (!(userUnit > 0 && Double.isFinite(userUnit))) throw new IOException("Invalid UserUnit");
        double x = b.getLowerLeftX(), y = b.getLowerLeftY(), w = b.getWidth(), h = b.getHeight(), u = userUnit;
        int rotation = Math.floorMod(page.getRotation(), 360);
        viewport = switch (rotation) {
            case 0 -> new AffineTransform(u, 0, 0, -u, -x*u, (y+h)*u);
            case 90 -> new AffineTransform(0, u, u, 0, -y*u, -x*u);
            case 180 -> new AffineTransform(-u, 0, 0, u, (x+w)*u, -y*u);
            case 270 -> new AffineTransform(0, -u, -u, 0, (y+h)*u, (x+w)*u);
            default -> throw new IOException("Non-quarter page rotation");
        };
        width = (rotation % 180 == 0 ? w : h)*u; height = (rotation % 180 == 0 ? h : w)*u;
        spool.emit(List.of("header", VERSION, width, height, rotation, u, List.of(x,y,w,h)));
    }
    static void finite(double v) throws IOException {
        if (!Double.isFinite(v) || Math.abs(v)>10_000_000) throw new IOException("Coordinate/value bound");
    }
    static List<Double> matrix(Matrix m) { return List.of((double)m.getScaleX(),(double)m.getShearY(),
        (double)m.getShearX(),(double)m.getScaleY(),(double)m.getTranslateX(),(double)m.getTranslateY()); }
    static List<Double> bounds(Rectangle2D r) { return List.of(r.getMinX(),r.getMinY(),r.getMaxX(),r.getMaxY()); }
    List<Double> viewBounds(Shape s) { return bounds(viewport.createTransformedShape(s).getBounds2D()); }
    static String json(Object v) throws IOException {
        if (v == null) return "null";
        if (v instanceof String s) {
            StringBuilder b = new StringBuilder("\"");
            for (char c:s.toCharArray()) {
                if(c=='"'||c=='\\') b.append('\\').append(c);
                else if(c<32) b.append(String.format("\\u%04x",(int)c)); else b.append(c);
            } return b.append('"').toString();
        }
        if(v instanceof Number n) {
            if (!Double.isFinite(n.doubleValue())) throw new IOException("Nonfinite JSON number");
            return n.toString();
        }
        if(v instanceof Boolean) return v.toString();
        if(v instanceof Map<?,?> m) {
            StringJoiner j=new StringJoiner(",","{","}");
            for(var e:m.entrySet()) j.add(json(e.getKey().toString())+":"+json(e.getValue())); return j.toString();
        }
        if(v instanceof Iterable<?> a) { StringJoiner j=new StringJoiner(",","[","]"); for(Object x:a) j.add(json(x)); return j.toString(); }
        if(v.getClass().isArray()) {
            StringJoiner j=new StringJoiner(",","[","]");
            for(int i=0;i<java.lang.reflect.Array.getLength(v);i++) j.add(json(java.lang.reflect.Array.get(v,i))); return j.toString();
        }
        throw new IOException("Unsupported JSON value "+v.getClass());
    }
    List<Double> packed(Shape shape, AffineTransform tx) throws IOException {
        List<Double> out=new ArrayList<>(); double[] c=new double[6]; int count=0;
        for(PathIterator it=shape.getPathIterator(tx);!it.isDone();it.next()) {
            if(++count>MAX_PATH_COMMANDS) throw new IOException("Single-path complexity bound");
            int kind=it.currentSegment(c); int n=switch(kind) {case 0,1->2;case 2->4;case 3->6;case 4->0;default->throw new IOException("Unknown path command");};
            out.add((double)kind); for(int i=0;i<n;i++){finite(c[i]);out.add(c[i]);}
        } return out;
    }
    int clipId() throws IOException {
        Area a=getGraphicsState().getCurrentClippingPath(); Integer cached=clipCache.get(a); if(cached!=null)return cached;
        String data=json(packed(a,viewport)); Integer id=clips.get(data);
        if(id==null) {
            if(clips.size()>=MAX_CLIPS) throw new IOException("Distinct clip bound"); id=clips.size();clips.put(data,id);
            spool.emitRaw("[\"c\","+id+","+data+"]");
        }
        // Cache is only an optimization. Bounding it never discards clip evidence.
        if(clipCache.size()>=MAX_CLIPS)clipCache.clear();clipCache.put(a,id);return id;
    }
    static List<Object> color(PDColor c) {
        int rgb=-1; try { if(!c.isPattern())rgb=c.toRGB(); } catch(IOException|RuntimeException ignored) { }
        return List.of(c.getColorSpace().getName(),c.getComponents(),rgb,c.isPattern());
    }
    int stateId() throws IOException {
        PDGraphicsState g=getGraphicsState(); Matrix m=g.getCurrentTransformationMatrix();
        double sx=Math.hypot(m.getScaleX(),m.getShearY()),sy=Math.hypot(m.getShearX(),m.getScaleY());
        boolean isotropic=sx>1e-12&&Math.abs(sx-sy)<1e-5*Math.max(1,sx)&&
            Math.abs(m.getScaleX()*m.getShearX()+m.getShearY()*m.getScaleY())<1e-5*Math.max(1,sx*sy);
        List<Object> data=List.of(matrix(m),(double)g.getLineWidth(),g.getLineCap(),g.getLineJoin(),(double)g.getMiterLimit(),
            color(g.getStrokingColor()),color(g.getNonStrokingColor()),g.getAlphaConstant(),g.getNonStrokeAlphaConstant(),
            g.getLineDashPattern().getDashArray(),g.getLineDashPattern().getPhase(),g.getBlendMode().getCOSName().getName(),
            g.getSoftMask()!=null,g.getTransfer()!=null,clipId(),isotropic,optionalDepth>0,groupDepth>0,g.isOverprint(),g.isNonStrokingOverprint());
        String key=json(data);Integer id=states.get(key);
        if(id==null){if(states.size()>=MAX_STATES)throw new IOException("Distinct state bound");id=states.size();states.put(key,id);spool.emitRaw("[\"s\","+id+","+key+"]");}
        return id;
    }
    void command() throws IOException {
        if(++commands>MAX_COMMANDS||commandOperators.size()>=MAX_PATH_COMMANDS)throw new IOException("Path command bound");
        commandOperators.add(currentOperator);String t=matrix(getGraphicsState().getCurrentTransformationMatrix()).toString();
        if(pathTransform==null)pathTransform=t;else if(!pathTransform.equals(t))pathMixedTransform=true;
    }
    @Override public void moveTo(float x,float y)throws IOException{finite(x);finite(y);command();path.moveTo(x,y);}
    @Override public void lineTo(float x,float y)throws IOException{finite(x);finite(y);command();path.lineTo(x,y);}
    @Override public void curveTo(float x1,float y1,float x2,float y2,float x3,float y3)throws IOException{
        for(float v:new float[]{x1,y1,x2,y2,x3,y3})finite(v);command();path.curveTo(x1,y1,x2,y2,x3,y3);
    }
    @Override public Point2D getCurrentPoint(){return path.getCurrentPoint();}
    @Override public void closePath()throws IOException{command();path.closePath();}
    @Override public void appendRectangle(Point2D a,Point2D b,Point2D c,Point2D d)throws IOException{
        moveTo((float)a.getX(),(float)a.getY());lineTo((float)b.getX(),(float)b.getY());lineTo((float)c.getX(),(float)c.getY());lineTo((float)d.getX(),(float)d.getY());closePath();
    }
    @Override public void clip(int winding){pendingClip=winding;}
    void finishPath(int paint,int winding)throws IOException{
        if(commandOperators.isEmpty())emptyPaths++;
        else {
            Rectangle2D b=path.getBounds2D();PDGraphicsState g=getGraphicsState();Matrix m=g.getCurrentTransformationMatrix();
            double scale=Math.hypot(m.getScaleX(),m.getShearY())+Math.hypot(m.getShearX(),m.getScaleY());
            double pad=(paint&1)==1?Math.abs(g.getLineWidth())*scale*Math.max(1,g.getMiterLimit()):0;
            boolean contained=g.getCurrentClippingPath().contains(b.getX()-pad,b.getY()-pad,b.getWidth()+2*pad,b.getHeight()+2*pad);
            // Degenerate horizontal/vertical zero-width bounds need a tiny nonzero containment box.
            if(pad==0&&paint==0)contained=true;
            spool.emit(List.of("p",++events,currentOperator,stateId(),paint,winding,packed(path,viewport),
                viewBounds(path),contained,pathMixedTransform,glyphDepth>0,commandOperators)); paths++;
        }
        if(pendingClip!=-1&&!commandOperators.isEmpty()){
            path.setWindingRule(pendingClip);getGraphicsState().intersectClippingPath(new Area(path));
        }
        pendingClip=-1;path.reset();commandOperators.clear();pathTransform=null;pathMixedTransform=false;
        if(events>MAX_EVENTS)throw new IOException("Paint event bound");
    }
    @Override public void endPath()throws IOException{finishPath(0,0);}
    @Override public void strokePath()throws IOException{finishPath(1,0);}
    @Override public void fillPath(int winding)throws IOException{finishPath(2,winding);}
    @Override public void fillAndStrokePath(int winding)throws IOException{finishPath(3,winding);}
    void occluder(String kind,Shape shape,boolean known,Object detail)throws IOException{
        spool.emit(Arrays.asList(kind,++events,currentOperator,stateId(),known,shape==null?null:viewBounds(shape),detail));
        if(events>MAX_EVENTS)throw new IOException("Paint event bound");
    }
    @Override public void drawImage(PDImage image)throws IOException{
        images++;Shape shape=getGraphicsState().getCurrentTransformationMatrix().createAffineTransform().createTransformedShape(new Rectangle2D.Double(0,0,1,1));
        occluder("image",shape,true,List.of(image.getWidth(),image.getHeight(),image.isStencil()));
    }
    @Override public void shadingFill(COSName name)throws IOException{
        occluder("shading",getGraphicsState().getCurrentClippingPath(),true,name.getName());
    }
    @Override protected void showFontGlyph(Matrix text,PDFont font,int code,Vector displacement)throws IOException{
        glyphs++;RenderingMode mode=getGraphicsState().getTextState().getRenderingMode();
        if(mode.isClip())throw new IOException("Text clipping requires a separately tested adapter");
        if(!mode.isFill()&&!mode.isStroke())return;
        Shape shape=null;boolean known=false;
        if(font instanceof PDVectorFont vectorFont&&font.isEmbedded()){
            GeneralPath glyph=vectorFont.getPath(code);
            if(glyph!=null){AffineTransform t=text.createAffineTransform();t.concatenate(font.getFontMatrix().createAffineTransform());
                shape=t.createTransformedShape(glyph);known=true;
                if(glyph.getPathIterator(null).isDone())return;
                if(mode.isStroke()){
                    // A conservative bound for stroked glyph paint, including miter joins.
                    Rectangle2D b=shape.getBounds2D();Matrix c=getGraphicsState().getCurrentTransformationMatrix();
                    double pad=Math.abs(getGraphicsState().getLineWidth())*(Math.hypot(c.getScaleX(),c.getShearY())+Math.hypot(c.getShearX(),c.getScaleY()))*Math.max(1,getGraphicsState().getMiterLimit());
                    shape=new Rectangle2D.Double(b.getX()-pad,b.getY()-pad,b.getWidth()+2*pad,b.getHeight()+2*pad);
                }
            }
        }
        if(!known)unknownGlyphs++;
        occluder("glyph",shape,known,Arrays.asList(font.getName(),code,font.toUnicode(code),font.isEmbedded(),mode.intValue(),matrix(text)));
    }
    @Override protected void showType3Glyph(Matrix text,PDType3Font font,int code,Vector displacement)throws IOException{
        glyphs++;if(getGraphicsState().getTextState().getRenderingMode().isClip())throw new IOException("Type3 text clipping unsupported");
        if(getGraphicsState().getTextState().getRenderingMode()==RenderingMode.NEITHER)return;
        if(++glyphDepth>32)throw new IOException("Glyph recursion bound");
        if(font.getCharProc(code)==null){unknownGlyphs++;occluder("glyph",null,false,"missing-Type3-charproc");glyphDepth--;return;}
        try{isolatedPath(()->super.showType3Glyph(text,font,code,displacement));}finally{glyphDepth--;}
    }
    @FunctionalInterface interface Child {void run()throws IOException;}
    void isolatedPath(Child child)throws IOException{
        Path2D.Double saved=path;List<Long> savedOps=commandOperators;
        int savedClip=pendingClip;String savedTransform=pathTransform;boolean savedMixed=pathMixedTransform;
        path=new Path2D.Double();commandOperators=new ArrayList<>();pendingClip=-1;pathTransform=null;pathMixedTransform=false;
        try{
            child.run();
            if(!commandOperators.isEmpty()||pendingClip!=-1)throw new IOException("Unconsumed child path");
        }finally{
            path=saved;commandOperators=savedOps;pendingClip=savedClip;pathTransform=savedTransform;pathMixedTransform=savedMixed;
        }
    }
    @Override public void showForm(PDFormXObject form)throws IOException{
        if(++formDepth>128)throw new IOException("Form nesting bound");
        boolean optional=form.getOptionalContent()!=null;if(optional)optionalDepth++;
        try{isolatedPath(()->super.showForm(form));}finally{formDepth--;if(optional)optionalDepth--;}
    }
    @Override public void showTransparencyGroup(PDTransparencyGroup group)throws IOException{
        if(++groupDepth>128)throw new IOException("Group nesting bound");
        try{isolatedPath(()->super.showTransparencyGroup(group));}finally{groupDepth--;}
    }
    @Override public void beginMarkedContentSequence(COSName tag,COSDictionary properties){
        boolean optional="OC".equals(tag.getName());marked.push(optional);if(optional)optionalDepth++;
        if(marked.size()>256)throw new IllegalStateException("Marked content bound");
    }
    @Override public void endMarkedContentSequence(){if(marked.isEmpty())throw new IllegalStateException("Unbalanced marked content");if(marked.pop())optionalDepth--;}
    @Override protected void processOperator(Operator op,List<COSBase> args)throws IOException{
        if(++operators>MAX_OPERATORS||getGraphicsStackSize()>256)throw new IOException("Operator/stack bound");
        long parent=currentOperator;currentOperator=operators;operatorCounts.merge(op.getName(),1L,Long::sum);
        try{super.processOperator(op,args);}finally{currentOperator=parent;}
    }
    @Override protected void operatorException(Operator op,List<COSBase> args,IOException e)throws IOException{throw e;}
    @Override protected void unsupportedOperator(Operator op,List<COSBase> args)throws IOException{
        if(!Set.of("BX","EX","MP","DP","d0","d1").contains(op.getName())){
            unsupported.merge(op.getName(),1L,Long::sum);occluder("unsupported",null,false,op.getName());
        }
    }
    static final class Spool implements AutoCloseable {
        final Path root;final List<Object> chunks=new ArrayList<>();GZIPOutputStream gzip;MessageDigest digest;Path file;
        long totalBytes,chunkBytes,records,chunkRecords;int ordinal;
        Spool(Path root){this.root=root;}
        void emit(Object value)throws IOException{emitRaw(json(value));}
        void emitRaw(String line)throws IOException{
            byte[] bytes=(line+"\n").getBytes(StandardCharsets.UTF_8);
            if(bytes.length>16*1024*1024||totalBytes+bytes.length>256L*1024*1024)throw new IOException("Spool byte bound");
            if(gzip==null){
                file=root.resolve(String.format("paint-%04d.jsonl.gz",ordinal++));
                try{digest=MessageDigest.getInstance("SHA-256");}catch(NoSuchAlgorithmException e){throw new IOException(e);}
                gzip=new GZIPOutputStream(new DigestOutputStream(Files.newOutputStream(file,StandardOpenOption.CREATE_NEW),digest),65536){{def.setLevel(Deflater.BEST_SPEED);}};
            }
            gzip.write(bytes);chunkBytes+=bytes.length;totalBytes+=bytes.length;records++;chunkRecords++;
            if(chunkBytes>=4*1024*1024)flushChunk();
        }
        void flushChunk()throws IOException{if(gzip==null)return;gzip.close();chunks.add(List.of(file.getFileName().toString(),HexFormat.of().formatHex(digest.digest()),Files.size(file),chunkBytes,chunkRecords));gzip=null;chunkBytes=chunkRecords=0;}
        public void close()throws IOException{flushChunk();}
    }
    public static void main(String[] args)throws Exception{
        if(args.length!=3)throw new IllegalArgumentException("INPUT ZERO_BASED_PAGE NEW_OUTPUT");
        Path input=Path.of(args[0]),output=Path.of(args[2]);int page=Integer.parseInt(args[1]);
        if(page<0||Files.size(input)>128L*1024*1024)throw new IOException("Input bound");
        Files.createDirectory(output);long start=System.nanoTime();
        try(PDDocument doc=Loader.loadPDF(new RandomAccessReadBufferedFile(input.toFile()));Spool spool=new Spool(output)){
            if(page>=doc.getNumberOfPages())throw new IOException("Page range");
            PDPage source=doc.getPage(page);StreamInk ink=new StreamInk(source,spool);ink.processPage(source);
            if(!ink.commandOperators.isEmpty()||!ink.marked.isEmpty())throw new IOException("Unconsumed path/marked content");
            int annotations=0;
            for(var a:source.getAnnotations())if(a.getRectangle()!=null){ink.occluder("annotation",a.getRectangle().toGeneralPath(),true,a.getSubtype());annotations++;}
            spool.close();
            Map<String,Object> summary=new LinkedHashMap<>();summary.put("version",VERSION);summary.put("pageIndex",page);summary.put("width",ink.width);summary.put("height",ink.height);
            summary.put("operators",ink.operators);summary.put("commands",ink.commands);summary.put("paths",ink.paths);summary.put("emptyPaths",ink.emptyPaths);summary.put("events",ink.events);
            summary.put("glyphs",ink.glyphs);summary.put("unknownGlyphs",ink.unknownGlyphs);summary.put("images",ink.images);summary.put("annotations",annotations);summary.put("states",ink.states.size());summary.put("clips",ink.clips.size());
            summary.put("operatorCounts",ink.operatorCounts);summary.put("unsupportedOperators",ink.unsupported);summary.put("uncompressedBytes",spool.totalBytes);summary.put("records",spool.records);summary.put("chunks",spool.chunks);
            summary.put("seconds",(System.nanoTime()-start)/1e9);summary.put("approvedForProduction",false);summary.put("roomAccuracyMeasured",false);
            Files.writeString(output.resolve("summary.json"),json(summary)+"\n",StandardOpenOption.CREATE_NEW);
        }
    }
}
