import { useEffect, useRef, useState } from "react";
import { useGetSettings, getGetSettingsQueryKey, useUpdateSettings, SettingsInput } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { Store, Mail, ImagePlus, Trash2, Palette, RotateCcw, Send, Link2, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { applyBrandColor, hexToHsl, hslStringToHex } from "@/lib/brand-color";
import { useBrandSettings } from "@/hooks/use-brand-settings";
import { Switch } from "@/components/ui/switch";
import { customFetch } from "@workspace/api-client-react";

// Preset palette for quick selection
const PRESETS = [
  { label: "Rosa Claudia",  hex: "#c06070" },
  { label: "Coral",         hex: "#e05c4a" },
  { label: "Morado",        hex: "#7c5cbf" },
  { label: "Teal",          hex: "#0d9488" },
  { label: "Azul",          hex: "#2563eb" },
  { label: "Verde",         hex: "#16a34a" },
  { label: "Índigo",        hex: "#4f46e5" },
  { label: "Ámbar",         hex: "#d97706" },
];

const DEFAULT_HEX = "#c06070";

export default function Configuracion() {
  const { data: settings, isLoading } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setBrandLogo = useBrandSettings((s) => s.setLogo);
  const setBrandColor = useBrandSettings((s) => s.setPrimaryColor);

  // ── Logo state ──────────────────────────────────────────────────
  // Prefer DB logoUrl; fallback to the shared store's cached value for
  // preview before settings load
  const storedLogo = useBrandSettings((s) => s.logoUrl);
  const [logo, setLogo] = useState<string | null>(storedLogo);

  // Sync logo from DB settings when loaded
  useEffect(() => {
    if (settings?.logoUrl) setLogo(settings.logoUrl);
  }, [settings?.logoUrl]);

  // ── Brand color state ────────────────────────────────────────────
  const [colorHex, setColorHex] = useState<string>(() => {
    if (settings?.primaryColor) return settings.primaryColor;
    const stored = localStorage.getItem("pos_brand_color");
    if (stored) return stored;
    try {
      const hsl = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
      if (hsl) return hslStringToHex(hsl);
    } catch {}
    return DEFAULT_HEX;
  });
  const [hexInput, setHexInput] = useState(colorHex);

  // Sync color from DB settings when loaded
  useEffect(() => {
    if (settings?.primaryColor) {
      setColorHex(settings.primaryColor);
    }
  }, [settings?.primaryColor]);

  // Sync text input when colorHex changes (e.g. preset click)
  useEffect(() => { setHexInput(colorHex); }, [colorHex]);

  const saveColorToDb = (hex: string) => {
    updateSettings.mutate({ data: { primaryColor: hex } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      }
    });
  };

  const applyAndSave = (hex: string) => {
    const valid = /^#[0-9a-fA-F]{6}$/.test(hex);
    if (!valid) return;
    setBrandColor(hex);
    setColorHex(hex);
    saveColorToDb(hex);
    toast({ title: "Color de marca actualizado" });
  };

  const handleHexInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.trim();
    if (!val.startsWith("#")) val = "#" + val;
    setHexInput(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      applyBrandColor(val);
      setColorHex(val);
    }
  };

  const commitHex = () => {
    const val = hexInput.startsWith("#") ? hexInput : "#" + hexInput;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      applyAndSave(val);
    } else {
      toast({ title: "Código inválido", description: "Usa el formato #RRGGBB", variant: "destructive" });
      setHexInput(colorHex);
    }
  };

  const resetColor = () => applyAndSave(DEFAULT_HEX);

  // ── Email notification toggles ─────────────────────────────────────
  const [sendInvoiceEmail, setSendInvoiceEmail] = useState(true);
  const [sendPaymentLinkEmail, setSendPaymentLinkEmail] = useState(true);
  const [testRecipient, setTestRecipient] = useState("");
  const [isTestingEmail, setIsTestingEmail] = useState(false);

  useEffect(() => {
    if (settings) {
      if (settings.sendInvoiceEmail !== undefined) setSendInvoiceEmail(!!settings.sendInvoiceEmail);
      if (settings.sendPaymentLinkEmail !== undefined) setSendPaymentLinkEmail(!!settings.sendPaymentLinkEmail);
    }
  }, [settings]);

  const toggleInvoiceEmail = (checked: boolean) => {
    setSendInvoiceEmail(checked);
    updateSettings.mutate({ data: { sendInvoiceEmail: checked } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: checked ? "Envío de facturas activado" : "Envío de facturas desactivado" });
      },
      onError: () => setSendInvoiceEmail(!checked),
    });
  };

  const togglePaymentLinkEmail = (checked: boolean) => {
    setSendPaymentLinkEmail(checked);
    updateSettings.mutate({ data: { sendPaymentLinkEmail: checked } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: checked ? "Envío automático de links de pago activado" : "Envío automático de links de pago desactivado" });
      },
      onError: () => setSendPaymentLinkEmail(!checked),
    });
  };

  // ── Settings form ────────────────────────────────────────────────
  const { register, handleSubmit, reset, getValues } = useForm<SettingsInput>();

  useEffect(() => {
    if (settings) {
      const formValues = Object.fromEntries(
        Object.entries(settings).map(([k, v]) => [k, v === null ? undefined : v])
      ) as SettingsInput;
      reset(formValues);
    }
  }, [settings, reset]);

  // ── Logo handlers ────────────────────────────────────────────────
  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Imagen muy grande", description: "El logo no puede superar 2 MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      setBrandLogo(base64);
      setLogo(base64);
      // Save to DB so all users see the logo
      updateSettings.mutate({ data: { logoUrl: base64 } as any }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          toast({ title: "Logo actualizado en el sistema" });
        }
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleRemoveLogo = () => {
    setBrandLogo(null);
    setLogo(null);
    updateSettings.mutate({ data: { logoUrl: "" } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: "Logo eliminado" });
      }
    });
  };

  const onSubmit = (data: SettingsInput) => {
    if (data.smtpPort && typeof data.smtpPort === "string") {
      data.smtpPort = Number(data.smtpPort);
    }
    updateSettings.mutate({ data }, {
      onSuccess: () => {
        toast({ title: "Configuración guardada exitosamente" });
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      },
    });
  };

  const handleTestEmail = async () => {
    const recipient = testRecipient.trim();
    if (!recipient) {
      toast({ title: "Indica el correo destinatario", variant: "destructive" });
      return;
    }

    const values = getValues();
    setIsTestingEmail(true);
    try {
      await customFetch<{ message: string }>("/api/settings/test-email", {
        method: "POST",
        body: JSON.stringify({
          recipient,
          storeName: values.storeName,
          smtpHost: values.smtpHost,
          smtpPort: values.smtpPort,
          smtpUser: values.smtpUser,
          smtpPass: values.smtpPass,
          smtpFrom: values.smtpFrom,
        }),
      });
      toast({ title: "Correo de prueba enviado", description: `Enviado a ${recipient}.` });
    } catch (error) {
      toast({
        title: "No se pudo enviar el correo",
        description: error instanceof Error ? error.message : "Verifica la configuración SMTP.",
        variant: "destructive",
      });
    } finally {
      setIsTestingEmail(false);
    }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Cargando configuración…</div>
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Configuración</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Ajustes globales del sistema</p>
      </div>

      {/* ── Color de Marca ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" />
            <CardTitle>Color de Marca</CardTitle>
          </div>
          <CardDescription>
            Define el color principal del sistema. Se guarda en la base de datos y se aplica para todos los usuarios.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Preview + inputs row */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Native color picker */}
            <label className="relative cursor-pointer group" title="Abrir selector de color">
              <div
                className="h-12 w-12 rounded-xl border-2 border-white shadow-md ring-1 ring-border transition-transform group-hover:scale-105"
                style={{ background: colorHex }}
              />
              <input
                type="color"
                value={colorHex}
                onChange={(e) => {
                  const hex = e.target.value;
                  applyBrandColor(hex);
                  setColorHex(hex);
                }}
                onBlur={(e) => applyAndSave(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
            </label>

            {/* Hex text input */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Input
                  value={hexInput}
                  onChange={handleHexInput}
                  onBlur={commitHex}
                  onKeyDown={(e) => e.key === "Enter" && commitHex()}
                  placeholder="#c06070"
                  className="w-32 font-mono text-sm h-10 uppercase"
                  maxLength={7}
                />
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={resetColor} title="Restaurar color por defecto" className="h-10 w-10 text-muted-foreground">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>

            {/* Live preview pill */}
            <div className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm" style={{ background: colorHex }}>
              Vista previa
            </div>
          </div>

          {/* Preset swatches */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Colores rápidos</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.hex}
                  type="button"
                  onClick={() => applyAndSave(p.hex)}
                  title={p.label}
                  className={`h-8 w-8 rounded-lg border-2 transition-all hover:scale-110 active:scale-95 shadow-sm ${
                    colorHex.toLowerCase() === p.hex.toLowerCase()
                      ? "border-foreground scale-110 shadow-md"
                      : "border-white/80 hover:border-foreground/40"
                  }`}
                  style={{ background: p.hex }}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Logo de la Tienda ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5 text-primary" />
            <CardTitle>Logo de la Tienda</CardTitle>
          </div>
          <CardDescription>
            Se muestra en el login y la barra de navegación. Se guarda en la base de datos y es visible para todos los usuarios.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/40 overflow-hidden">
              {logo ? (
                <img src={logo} alt="Logo actual" className="h-full w-full object-contain p-2" />
              ) : (
                <div className="flex flex-col items-center gap-1 text-muted-foreground">
                  <Store className="h-8 w-8" />
                  <span className="text-xs">Sin logo</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
                <ImagePlus className="h-4 w-4" />
                {logo ? "Cambiar logo" : "Subir logo"}
              </Button>
              {logo && (
                <Button type="button" variant="ghost" onClick={handleRemoveLogo}
                  className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-4 w-4" />
                  Eliminar logo
                </Button>
              )}
              <p className="text-xs text-muted-foreground">PNG, JPG o SVG · máx. 2 MB</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* ── Información de la Tienda ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Store className="h-5 w-5 text-primary" />
              <CardTitle>Información de la Tienda</CardTitle>
            </div>
            <CardDescription>Datos que aparecerán en los tickets y recibos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Nombre de la Tienda</label>
                <Input {...register("storeName")} required />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Correo Electrónico</label>
                <Input {...register("storeEmail")} type="email" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Dirección Física</label>
              <Input {...register("storeAddress")} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Teléfono</label>
              <Input {...register("storePhone")} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Instagram (URL)</label>
                <Input {...register("instagramUrl")} placeholder="https://instagram.com/tu_tienda" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">TikTok (URL)</label>
                <Input {...register("tiktokUrl")} placeholder="https://tiktok.com/@tu_tienda" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Notificaciones por Correo ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              <CardTitle>Notificaciones por Correo</CardTitle>
            </div>
            <CardDescription>Controla qué correos se envían automáticamente a los clientes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border p-3.5">
              <div className="flex items-start gap-3">
                <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Envío de facturas</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Envía la factura por correo al cliente después de cada venta</p>
                </div>
              </div>
              <Switch checked={sendInvoiceEmail} onCheckedChange={toggleInvoiceEmail} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3.5">
              <div className="flex items-start gap-3">
                <Link2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Envío automático de links de pago</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Envía el link de pago Bold por correo automáticamente cuando se genera</p>
                </div>
              </div>
              <Switch checked={sendPaymentLinkEmail} onCheckedChange={togglePaymentLinkEmail} />
            </div>
          </CardContent>
        </Card>

        {/* ── SMTP ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <CardTitle>Servidor SMTP</CardTitle>
            </div>
            <CardDescription>Configuración para el envío de correos y reportes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Servidor Host</label>
                <Input {...register("smtpHost")} placeholder="smtp.gmail.com" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Puerto</label>
                <Input {...register("smtpPort")} type="number" placeholder="587" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Usuario SMTP</label>
                <Input {...register("smtpUser")} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Contraseña SMTP</label>
                <Input {...register("smtpPass")} type="password" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Remitente (From)</label>
              <Input {...register("smtpFrom")} placeholder="noreply@claudiavanegas.com" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="smtp-test-recipient" className="text-sm font-semibold">Correo destinatario de la prueba</label>
              <Input
                id="smtp-test-recipient"
                type="email"
                value={testRecipient}
                onChange={(event) => setTestRecipient(event.target.value)}
                placeholder="correo@ejemplo.com"
                autoComplete="email"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                La prueba usa los valores actuales del formulario, aunque aún no los hayas guardado.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleTestEmail}
                disabled={isTestingEmail}
                className="gap-2"
              >
                {isTestingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {isTestingEmail ? "Enviando..." : "Enviar correo de prueba"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={updateSettings.isPending} className="min-w-32">
            {updateSettings.isPending ? "Guardando..." : "Guardar Cambios"}
          </Button>
        </div>
      </form>
    </div>
  );
}
